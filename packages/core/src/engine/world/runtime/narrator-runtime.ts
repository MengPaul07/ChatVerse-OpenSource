import type {
  NarrativeBeat,
  ResolvedWorldDirectorPolicy,
  WorldForegroundFailureKind,
  WorldForegroundOperation,
  WorldForegroundResponsibility,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { RuntimeHost, RuntimeTask } from "../../../runtime/types.js";
import {
  providerFailureDetails,
  type ProviderFailureDetails,
} from "../../provider-failure.js";
import type {
  NarratorMode,
  NarratorResult,
  NarratorView,
  WorldNarrator,
} from "../narrator/index.js";
import type { ForegroundRecoveryIntent } from "./foreground-recovery.js";
import {
  errorToMessage,
  higherNarratorMode,
  unique,
} from "./helpers.js";

interface NarratorContextJob {
  pendingMode?: NarratorMode;
  pendingDirection?: string;
  sourceEventIds: string[];
  running: boolean;
  task?: RuntimeTask;
  controller?: AbortController;
}

interface NarratorForegroundRequest {
  contextId: string;
  operation: WorldForegroundOperation;
  responsibility: WorldForegroundResponsibility;
  intent: ForegroundRecoveryIntent;
  expectedAt?: number;
  beatId?: string;
}

interface NarratorRuntimeHost {
  runtime: RuntimeHost;
  policy: ResolvedWorldDirectorPolicy;
  narrator: WorldNarrator;
  isRunning(): boolean;
  isPaused(): boolean;
  lifecycleEpoch(): number;
  activeBeatForContext(contextId: string): NarrativeBeat | undefined;
  canRunNarrator(contextId: string): boolean;
  buildNarratorView(
    contextId: string,
    beat: NarrativeBeat,
    sourceEventIds: readonly string[],
    direction?: string,
  ): NarratorView;
  applyNarratorResult(
    contextId: string,
    beat: NarrativeBeat,
    mode: NarratorMode,
    result: NarratorResult,
    sourceEventIds: readonly string[],
  ): void;
  beatActorTurnCount(beat: NarrativeBeat): number;
  minimumBeatActorTurns(beat: NarrativeBeat): number;
  latestContextEventIds(contextId: string, limit: number): string[];
  expectForegroundOperation(input: NarratorForegroundRequest): boolean;
  startForegroundOperation(contextId: string, operation: WorldForegroundOperation): void;
  clearForegroundOperation(contextId: string, operation: WorldForegroundOperation): void;
  failForegroundOperation(
    contextId: string,
    operation: WorldForegroundOperation,
    kind: WorldForegroundFailureKind,
    message: string,
    userMessage?: string,
    retryable?: boolean,
  ): void;
  retryOrFailForegroundOperation(
    contextId: string,
    operation: WorldForegroundOperation,
    kind: WorldForegroundFailureKind,
    message: string,
    retryDelayMs: number,
  ): boolean;
  handleBlockingProviderFailure(
    error: ProviderFailureDetails,
    input: { contextId: string; operation: "narrator" },
  ): boolean;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/** Owns Narrator jobs, debounce checkpoints, cancellation and retries. */
export class NarratorRuntime {
  private readonly jobs = new Map<string, NarratorContextJob>();
  private readonly checkpointActorTurns = new Map<string, number>();

  constructor(private readonly host: NarratorRuntimeHost) {}

  schedule(
    contextId: string,
    mode: NarratorMode,
    sourceEventIds: readonly string[] = [],
    delayMs = 0,
    direction?: string,
  ): void {
    if (!this.host.isRunning()) return;
    const beat = this.host.activeBeatForContext(contextId);
    if (!beat) return;
    if (!this.host.expectForegroundOperation({
      contextId,
      operation: "narrator",
      responsibility: mode === "open_beat" ? "open_beat" : "arbitrate_turn",
      intent: {
        operation: "narrator",
        mode,
        sourceEventIds: [...sourceEventIds],
        ...(direction ? { direction } : {}),
      },
      expectedAt: this.host.runtime.clock.now() + delayMs,
      beatId: beat.id,
    })) return;
    const job = this.jobs.get(contextId) ?? {
      sourceEventIds: [],
      running: false,
    };
    this.jobs.set(contextId, job);
    job.pendingMode = higherNarratorMode(job.pendingMode, mode);
    if (direction) job.pendingDirection = direction;
    job.sourceEventIds = unique([...job.sourceEventIds, ...sourceEventIds]).slice(-12);
    if (job.running) return;
    if (job.task) {
      if (delayMs > 0) return;
      job.task.cancel();
      job.task = undefined;
    }
    job.task = this.host.runtime.scheduler.schedule(delayMs, () => {
      job.task = undefined;
      void this.run(contextId);
    });
  }

  /** Preserve a direction request until the next Beat exists. */
  defer(contextId: string, mode: NarratorMode, direction?: string): void {
    const job = this.jobs.get(contextId) ?? {
      sourceEventIds: [],
      running: false,
    };
    job.pendingMode = higherNarratorMode(job.pendingMode, mode);
    job.pendingDirection = direction;
    job.sourceEventIds = [];
    this.jobs.set(contextId, job);
  }

  maybeScheduleBeatClosureCheck(
    contextId: string,
    beatId: string,
    force = false,
    sourceEventIds: readonly string[] = [],
  ): void {
    const beat = this.host.activeBeatForContext(contextId);
    if (!beat || beat.id !== beatId) return;
    const progress = this.host.beatActorTurnCount(beat);
    const previousCheckpoint = this.checkpointActorTurns.get(beat.id);
    if (!force) {
      const minimumCheckProgress = Math.min(
        4,
        this.host.minimumBeatActorTurns(beat),
      );
      if (progress < minimumCheckProgress) return;
      if (previousCheckpoint != null && progress - previousCheckpoint < 4) return;
    }
    this.checkpointActorTurns.set(beat.id, progress);
    this.schedule(
      contextId,
      "check_closure",
      unique([
        ...this.host.latestContextEventIds(contextId, 8),
        ...sourceEventIds,
      ]),
      this.host.policy.narratorDebounceMs,
    );
  }

  clearCheckpoint(beatId: string): void {
    this.checkpointActorTurns.delete(beatId);
  }

  pause(): void {
    for (const job of this.jobs.values()) job.controller?.abort();
    for (const job of this.jobs.values()) {
      job.task?.cancel();
      job.task = undefined;
    }
  }

  resume(): void {
    for (const [contextId, job] of this.jobs) {
      if (job.pendingMode) this.schedule(contextId, job.pendingMode);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.controller?.abort();
      job.task?.cancel();
    }
    this.jobs.clear();
    this.checkpointActorTurns.clear();
  }

  abort(contextId: string): void {
    const job = this.jobs.get(contextId);
    job?.controller?.abort();
    job?.task?.cancel();
    if (job) job.task = undefined;
  }

  interrupt(contextId: string): void {
    const job = this.jobs.get(contextId);
    job?.controller?.abort();
    job?.task?.cancel();
    if (!job) return;
    job.controller = undefined;
    job.task = undefined;
    job.pendingMode = undefined;
    job.pendingDirection = undefined;
    job.sourceEventIds = [];
  }

  private async run(contextId: string): Promise<void> {
    const job = this.jobs.get(contextId);
    if (!this.host.isRunning() || !job || job.running) return;
    const mode = job.pendingMode;
    const beat = this.host.activeBeatForContext(contextId);
    if (!mode || !beat || !this.host.canRunNarrator(contextId)) return;
    job.pendingMode = undefined;
    const direction = job.pendingDirection;
    job.pendingDirection = undefined;
    const sourceEventIds = job.sourceEventIds;
    job.sourceEventIds = [];
    job.running = true;
    this.host.startForegroundOperation(contextId, "narrator");
    const controller = new AbortController();
    job.controller = controller;
    const epoch = this.host.lifecycleEpoch();
    const narratorView = this.host.buildNarratorView(
      contextId,
      beat,
      sourceEventIds,
      direction,
    );
    this.host.notify("narrator.started", {
      contextId,
      beatId: beat.id,
      mode,
      triggerSource: narratorView.triggerSource,
    });
    try {
      const result = await this.host.narrator.run(mode, narratorView, controller.signal);
      if (
        controller.signal.aborted ||
        epoch !== this.host.lifecycleEpoch() ||
        !this.host.isRunning()
      ) return;
      this.host.clearForegroundOperation(contextId, "narrator");
      this.host.applyNarratorResult(contextId, beat, mode, result, sourceEventIds);
    } catch (error) {
      if (controller.signal.aborted && this.host.isPaused()) {
        job.pendingMode = higherNarratorMode(job.pendingMode, mode);
        if (direction) job.pendingDirection = direction;
        job.sourceEventIds = unique([...job.sourceEventIds, ...sourceEventIds]).slice(-12);
      }
      if (!controller.signal.aborted) {
        const providerFailure = providerFailureDetails(error);
        const blocked = this.host.handleBlockingProviderFailure(
          providerFailure,
          { contextId, operation: "narrator" },
        );
        if (blocked) {
          this.host.failForegroundOperation(
            contextId,
            "narrator",
            "provider",
            errorToMessage(error),
            "模型连接需要处理，修复配置后可重试场景仲裁。",
            false,
          );
        } else {
          const failureKind: WorldForegroundFailureKind = errorToMessage(error).includes("invalid response")
            ? "protocol"
            : "provider";
          const retryScheduled = this.host.retryOrFailForegroundOperation(
            contextId,
            "narrator",
            failureKind,
            errorToMessage(error),
            narratorRetryDelayMs(failureKind, providerFailure.code),
          );
          if (!retryScheduled) {
            this.host.notify("narrator.error", {
              contextId,
              beatId: beat.id,
              mode,
              message: errorToMessage(error),
            });
          }
        }
      }
    } finally {
      if (job.controller === controller) job.controller = undefined;
      job.running = false;
      if (job.pendingMode && this.host.isRunning()) {
        this.schedule(contextId, job.pendingMode);
      }
    }
  }
}

function narratorRetryDelayMs(
  failureKind: WorldForegroundFailureKind,
  providerCode: string | undefined,
): number {
  if (failureKind === "protocol") return 0;
  if (providerCode === "provider_timeout") return 250;
  if (providerCode === "provider_rate_limited") return 5_000;
  return 1_000;
}
