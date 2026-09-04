import type {
  WorldDismissForegroundFailureInput,
  WorldForegroundFailureKind,
  WorldForegroundOperation,
  WorldForegroundRecoveryState,
  WorldForegroundResponsibility,
  WorldRetryForegroundOperationInput,
} from "../../../contracts/world.js";
import type { RuntimeHost, RuntimeTask } from "../../../runtime/types.js";
import type { NarratorMode } from "../narrator/index.js";
import type { ActorWakeSource } from "../session-binding.js";

const STALL_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 210_000;
const MAX_AUTOMATIC_RETRIES = 1;

export type ForegroundRecoveryIntent =
  | { operation: "director" }
  | { operation: "narrator"; mode: NarratorMode; sourceEventIds: string[]; direction?: string }
  | {
      operation: "actor"; actorId: string; source: ActorWakeSource; reason: string;
      messageId?: string; requiresReply: boolean; priority: number; causationId?: string; beatId?: string;
    }
  | { operation: "player"; beatId: string; prompt: string; guidance: string };

export interface ForegroundRecoveryHost {
  isRunning(): boolean;
  notify(type: string, payload: Record<string, unknown>): void;
  abort(contextId: string, operation: WorldForegroundOperation): void;
  execute(contextId: string, intent: ForegroundRecoveryIntent | undefined): boolean;
  settleDismissedActor(contextId: string, actorId: string): void;
}

export class ForegroundRecoveryController {
  private readonly recoveries = new Map<string, WorldForegroundRecoveryState>();
  private readonly intents = new Map<string, ForegroundRecoveryIntent>();
  private readonly tasks = new Map<string, RuntimeTask>();

  constructor(
    private readonly runtime: RuntimeHost,
    private readonly host: ForegroundRecoveryHost,
    restored: readonly WorldForegroundRecoveryState[] = [],
    private readonly maxAutomaticRetries = MAX_AUTOMATIC_RETRIES,
  ) {
    for (const recovery of restored) {
      if (recovery.status === "failed") this.recoveries.set(recovery.contextId, structuredClone(recovery));
    }
  }

  snapshot(): WorldForegroundRecoveryState[] {
    return [...this.recoveries.values()].map((item) => structuredClone(item));
  }

  get(contextId: string): WorldForegroundRecoveryState | undefined {
    const recovery = this.recoveries.get(contextId);
    return recovery ? structuredClone(recovery) : undefined;
  }

  expect(input: {
    contextId: string; operation: WorldForegroundOperation; responsibility: WorldForegroundResponsibility;
    intent: ForegroundRecoveryIntent; expectedAt?: number; beatId?: string; actorId?: string;
  }): boolean {
    if (!this.host.isRunning()) return false;
    const existing = this.recoveries.get(input.contextId);
    if (existing?.status === "failed") return false;
    if (existing?.operation === input.operation) {
      this.intents.set(input.contextId, input.intent);
      return true;
    }
    if (existing) this.clear(input.contextId, existing.operation);
    const now = this.now();
    const recovery: WorldForegroundRecoveryState = {
      id: `recovery:${this.runtime.idGenerator.next()}`, contextId: input.contextId,
      operation: input.operation, responsibility: input.responsibility, status: "expected",
      attempt: 0,
      maxAutomaticRetries: Math.max(0, this.maxAutomaticRetries),
      expectedAt: input.expectedAt ?? now, lastProgressAt: now,
      ...(input.beatId ? { beatId: input.beatId } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
    };
    this.recoveries.set(input.contextId, recovery);
    this.intents.set(input.contextId, input.intent);
    this.host.notify("runtime.operation_expected", { recovery: structuredClone(recovery) });
    this.arm(input.contextId, Math.max(0, recovery.expectedAt - now) + STALL_TIMEOUT_MS);
    return true;
  }

  start(contextId: string, operation: WorldForegroundOperation): void {
    const recovery = this.recoveries.get(contextId);
    if (!recovery || recovery.operation !== operation || recovery.status === "failed") return;
    recovery.status = "running";
    recovery.lastProgressAt = this.now();
    recovery.retryAt = undefined;
    this.host.notify("runtime.operation_started", { recovery: structuredClone(recovery) });
    this.arm(contextId, REQUEST_TIMEOUT_MS);
  }

  rescheduleExpected(contextId: string, operation: WorldForegroundOperation, expectedAt: number): void {
    const recovery = this.recoveries.get(contextId);
    if (!recovery || recovery.operation !== operation || recovery.status === "failed") return;
    recovery.status = "expected";
    recovery.expectedAt = expectedAt;
    recovery.lastProgressAt = this.now();
    recovery.retryAt = expectedAt;
    this.host.notify("runtime.operation_expected", { recovery: structuredClone(recovery) });
    this.arm(contextId, Math.max(0, expectedAt - this.now()) + STALL_TIMEOUT_MS);
  }

  clear(contextId: string, operation: WorldForegroundOperation): void {
    const recovery = this.recoveries.get(contextId);
    if (!recovery || recovery.operation !== operation) return;
    this.cancelTask(contextId);
    this.recoveries.delete(contextId);
    this.intents.delete(contextId);
    this.host.notify("runtime.operation_recovered", { contextId, recoveryId: recovery.id, operation });
  }

  fail(contextId: string, operation: WorldForegroundOperation, kind: WorldForegroundFailureKind,
    message: string, userMessage?: string, retryable = true): void {
    const recovery = this.recoveries.get(contextId);
    if (!recovery || recovery.operation !== operation) return;
    this.cancelTask(contextId);
    recovery.status = "failed";
    recovery.retryAt = undefined;
    recovery.lastProgressAt = this.now();
    recovery.failure = {
      id: `failure:${this.runtime.idGenerator.next()}`, kind, message,
      userMessage: userMessage ?? foregroundFailureMessage(operation, kind), retryable, occurredAt: this.now(),
    };
    this.host.notify("runtime.operation_failed", { recovery: structuredClone(recovery) });
  }

  retryOrFail(contextId: string, operation: WorldForegroundOperation, kind: WorldForegroundFailureKind,
    message: string, retryDelayMs: number): boolean {
    const recovery = this.recoveries.get(contextId);
    if (!recovery || recovery.operation !== operation) return false;
    if (recovery.attempt >= recovery.maxAutomaticRetries) {
      this.fail(contextId, operation, kind, message);
      return false;
    }
    recovery.attempt += 1;
    recovery.status = "retry_scheduled";
    recovery.retryAt = this.now() + retryDelayMs;
    recovery.lastProgressAt = this.now();
    this.host.notify("runtime.retry_scheduled", { recovery: structuredClone(recovery) });
    this.scheduleExecution(contextId, retryDelayMs);
    return true;
  }

  retry(input: WorldRetryForegroundOperationInput): boolean {
    if (!this.host.isRunning()) return false;
    const recovery = this.recoveries.get(input.contextId);
    if (!recovery || recovery.status !== "failed" || recovery.failure?.id !== input.failureId || !recovery.failure.retryable) return false;
    recovery.attempt += 1;
    recovery.status = "retry_scheduled";
    recovery.retryAt = this.now();
    recovery.failure = undefined;
    recovery.lastProgressAt = this.now();
    this.host.notify("runtime.retry_scheduled", { recovery: structuredClone(recovery) });
    this.scheduleExecution(input.contextId, 0);
    return true;
  }

  dismiss(input: WorldDismissForegroundFailureInput): boolean {
    const recovery = this.recoveries.get(input.contextId);
    if (!recovery || recovery.status !== "failed" || recovery.failure?.id !== input.failureId) return false;
    const intent = this.intents.get(input.contextId);
    this.cancelTask(input.contextId);
    this.recoveries.delete(input.contextId);
    this.intents.delete(input.contextId);
    this.host.notify("runtime.operation_recovered", {
      contextId: input.contextId, recoveryId: recovery.id, operation: recovery.operation,
    });
    if (intent?.operation === "actor") this.host.settleDismissedActor(input.contextId, intent.actorId);
    return true;
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) task.cancel();
    this.tasks.clear();
  }

  cancel(contextId: string): void {
    this.cancelTask(contextId);
  }

  resume(delayMs = 5_000): void {
    for (const recovery of this.recoveries.values()) {
      if (recovery.status === "failed") continue;
      recovery.status = "expected";
      recovery.expectedAt = this.now() + delayMs;
      recovery.lastProgressAt = this.now();
      this.host.notify("runtime.operation_expected", { recovery: structuredClone(recovery) });
      this.arm(recovery.contextId, delayMs + STALL_TIMEOUT_MS);
    }
  }

  resumeContext(contextId: string, delayMs = 5_000): void {
    const recovery = this.recoveries.get(contextId);
    if (!recovery || recovery.status === "failed") return;
    recovery.status = "expected";
    recovery.expectedAt = this.now() + delayMs;
    recovery.lastProgressAt = this.now();
    this.host.notify("runtime.operation_expected", { recovery: structuredClone(recovery) });
    this.arm(contextId, delayMs + STALL_TIMEOUT_MS);
  }

  private arm(contextId: string, delayMs: number): void {
    this.cancelTask(contextId);
    if (!this.host.isRunning()) return;
    this.tasks.set(contextId, this.runtime.scheduler.schedule(delayMs, () => {
      this.tasks.delete(contextId);
      const recovery = this.recoveries.get(contextId);
      if (!recovery || recovery.status === "failed" || !this.host.isRunning()) return;
      const kind: WorldForegroundFailureKind = recovery.status === "running" ? "timeout" : "stalled";
      if (recovery.attempt >= recovery.maxAutomaticRetries) {
        this.host.abort(contextId, recovery.operation);
        this.fail(contextId, recovery.operation, kind,
          kind === "timeout" ? "Foreground provider request timed out." : "Foreground operation did not start.");
        return;
      }
      recovery.attempt += 1;
      recovery.status = "retry_scheduled";
      recovery.retryAt = this.now();
      recovery.lastProgressAt = this.now();
      this.host.notify("runtime.retry_scheduled", { recovery: structuredClone(recovery) });
      this.host.abort(contextId, recovery.operation);
      this.scheduleExecution(contextId, kind === "timeout" ? 100 : 0);
    }));
  }

  private scheduleExecution(contextId: string, delayMs: number): void {
    this.cancelTask(contextId);
    this.tasks.set(contextId, this.runtime.scheduler.schedule(delayMs, () => {
      this.tasks.delete(contextId);
      if (!this.host.isRunning()) return;
      const recovery = this.recoveries.get(contextId);
      if (!recovery || recovery.status === "failed") return;
      recovery.status = "expected";
      recovery.expectedAt = this.now();
      recovery.lastProgressAt = this.now();
      recovery.retryAt = undefined;
      this.host.notify("runtime.operation_expected", { recovery: structuredClone(recovery) });
      if (!this.host.execute(contextId, this.intents.get(contextId))) {
        this.fail(contextId, recovery.operation, "task_incomplete", "Foreground recovery intent is no longer executable.");
      }
    }));
  }

  private cancelTask(contextId: string): void {
    this.tasks.get(contextId)?.cancel();
    this.tasks.delete(contextId);
  }

  private now(): number { return this.runtime.clock.now(); }
}

function foregroundFailureMessage(operation: WorldForegroundOperation, kind: WorldForegroundFailureKind): string {
  const subject = operation === "director" ? "剧情规划" : operation === "narrator" ? "场景仲裁" : operation === "actor" ? "角色回应" : "玩家选项";
  if (kind === "stalled") return `${subject}没有按预期启动。`;
  if (kind === "timeout") return `${subject}等待模型响应超时。`;
  if (kind === "protocol") return `${subject}连续返回了无法解析的结果。`;
  if (kind === "task_incomplete") return `${subject}未完成本轮必要任务。`;
  return `${subject}暂时失败，请重试。`;
}
