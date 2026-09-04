import type {
  NarrativeBeat,
  WorldForegroundFailureKind,
  WorldForegroundOperation,
  WorldForegroundResponsibility,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { ProviderFailureDetails } from "../../provider-failure.js";
import { blockingProviderIssue } from "../../provider-failure.js";
import type { ActorRuntimeWakeInput } from "./actor-runtime.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import {
  ForegroundRecoveryController,
  type ForegroundRecoveryIntent,
} from "./foreground-recovery.js";
import type { NarratorMode } from "../narrator/index.js";

export interface ForegroundOperationsHost {
  recovery: ForegroundRecoveryController;
  isRunning(): boolean;
  now(): number;
  getContextRuntime(contextId: string): ChatContextRuntime | undefined;
  getActiveBeat(contextId: string): NarrativeBeat | undefined;
  getBeat(beatId: string): NarrativeBeat | undefined;
  isConversationContext(context: ChatContextRuntime): boolean;
  requestActorWake(input: ActorRuntimeWakeInput): boolean;
  preparePlayerTurn(
    contextId: string,
    beat: NarrativeBeat,
    prompt: string,
    guidance: string,
  ): void;
  abortPlayerTurn(contextId: string): void;
  interruptActorWork(contextId: string): void;
  abortDirector(): void;
  abortNarrator(contextId: string): void;
  pauseContext(contextId: string): void;
  pauseWorld(): void;
  scheduleDirector(immediate: boolean, reason: string): void;
  scheduleNarrator(
    contextId: string,
    mode: NarratorMode,
    sourceEventIds?: readonly string[],
    delayMs?: number,
    direction?: string,
  ): void;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/** Coordinates foreground recovery without owning the underlying runtimes. */
export class ForegroundOperationsRuntime {
  private providerBlockKey?: string;

  constructor(private readonly host: ForegroundOperationsHost) {}

  handleBlockingProviderFailure(
    error: ProviderFailureDetails,
    source: {
      contextId?: string;
      operation: "director" | "narrator" | "actor" | "player" | "memory" | "compression" | "unknown";
    },
  ): boolean {
    const issue = blockingProviderIssue(error);
    if (!issue) return false;

    const key = `${issue.kind}:${issue.status ?? ""}:${issue.code ?? ""}:${source.contextId ?? "world"}`;
    if (this.providerBlockKey !== key) {
      this.providerBlockKey = key;
      this.host.notify("provider.blocked", {
        contextId: source.contextId,
        operation: source.operation,
        kind: issue.kind,
        status: issue.status,
        code: issue.code,
        message: issue.message,
        userMessage: issue.userMessage,
      });
    }

    const context = source.contextId
      ? this.host.getContextRuntime(source.contextId)
      : undefined;
    if (context && this.host.isConversationContext(context)) {
      this.host.pauseContext(context.definition.id);
    } else if (this.host.isRunning()) {
      this.host.pauseWorld();
    }
    return true;
  }

  expect(input: {
    contextId: string;
    operation: WorldForegroundOperation;
    responsibility: WorldForegroundResponsibility;
    intent: ForegroundRecoveryIntent;
    expectedAt?: number;
    beatId?: string;
    actorId?: string;
  }): boolean {
    return this.host.recovery.expect(input);
  }

  start(contextId: string, operation: WorldForegroundOperation): void {
    this.host.recovery.start(contextId, operation);
  }

  rescheduleExpected(
    contextId: string,
    operation: WorldForegroundOperation,
    expectedAt: number,
  ): void {
    this.host.recovery.rescheduleExpected(contextId, operation, expectedAt);
  }

  clear(contextId: string, operation: WorldForegroundOperation): void {
    this.host.recovery.clear(contextId, operation);
  }

  fail(
    contextId: string,
    operation: WorldForegroundOperation,
    kind: WorldForegroundFailureKind,
    message: string,
    userMessage?: string,
    retryable = true,
  ): void {
    this.host.recovery.fail(contextId, operation, kind, message, userMessage, retryable);
  }

  retryOrFail(
    contextId: string,
    operation: WorldForegroundOperation,
    kind: WorldForegroundFailureKind,
    message: string,
    retryDelayMs: number,
  ): boolean {
    return this.host.recovery.retryOrFail(contextId, operation, kind, message, retryDelayMs);
  }

  retryMany(
    operation: WorldForegroundOperation,
    contextIds: readonly string[],
    kind: WorldForegroundFailureKind,
    message: string,
    retryDelayMs: number,
  ): boolean {
    const [primaryContextId, ...remainingContextIds] = contextIds;
    if (!primaryContextId) return false;
    const scheduled = this.retryOrFail(
      primaryContextId,
      operation,
      kind,
      message,
      retryDelayMs,
    );
    if (!scheduled) {
      for (const contextId of remainingContextIds) {
        this.fail(contextId, operation, kind, message);
      }
      return false;
    }
    const expectedAt = this.host.now() + retryDelayMs;
    for (const contextId of remainingContextIds) {
      this.rescheduleExpected(contextId, operation, expectedAt);
    }
    return true;
  }

  abort(contextId: string, operation: WorldForegroundOperation): void {
    if (operation === "director") {
      this.host.abortDirector();
      return;
    }
    if (operation === "narrator") {
      this.host.abortNarrator(contextId);
      return;
    }
    if (operation === "player") {
      this.host.abortPlayerTurn(contextId);
      return;
    }
    this.host.interruptActorWork(contextId);
  }

  executeRecovery(contextId: string, intent?: ForegroundRecoveryIntent): boolean {
    if (!this.host.isRunning()) return false;
    if (intent?.operation === "director") {
      this.host.scheduleDirector(true, "foreground_retry");
      return true;
    }
    if (intent?.operation === "narrator") {
      this.host.scheduleNarrator(
        contextId,
        intent.mode,
        intent.sourceEventIds,
        0,
        intent.direction,
      );
      return true;
    }
    if (intent?.operation === "actor") {
      const context = this.host.getContextRuntime(contextId);
      if (context && this.host.requestActorWake({ context, ...intent })) return true;
    }
    if (intent?.operation === "player") {
      const beat = this.host.getBeat(intent.beatId);
      if (beat?.status === "running") {
        this.host.preparePlayerTurn(contextId, beat, intent.prompt, intent.guidance);
        return true;
      }
    }
    const beat = this.host.getActiveBeat(contextId);
    if (beat) {
      this.host.scheduleNarrator(contextId, "check_closure");
      return true;
    }
    this.host.scheduleDirector(true, "foreground_retry");
    return true;
  }
}
