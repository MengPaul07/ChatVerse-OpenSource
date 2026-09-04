import type {
  RuntimeHost,
  World,
  WorldEvent,
} from "@chatverse/core";
import type {
  WorldRunLabOptions,
  WorldRunStabilityMetrics,
  WorldRunStep,
} from "./types.js";

type WorldDebugSnapshot = ReturnType<World["debugSnapshot"]>;

export interface FastForwardRuntime extends RuntimeHost {
  advanceBy(ms: number): void;
  advanceTo(timestamp: number): void;
  nextDueAt(): number | undefined;
  pendingTaskCount(): number;
}

export function asFastForwardRuntime(runtime: RuntimeHost): FastForwardRuntime | undefined {
  const candidate = runtime as Partial<FastForwardRuntime>;
  return typeof candidate.advanceBy === "function" &&
    typeof candidate.advanceTo === "function" &&
    typeof candidate.nextDueAt === "function" &&
    typeof candidate.pendingTaskCount === "function"
    ? candidate as FastForwardRuntime
    : undefined;
}

interface WorldRunSettlerDependencies {
  runtime: RuntimeHost;
  manualRuntime?: FastForwardRuntime;
  getWorld: () => World;
  getEvents: () => readonly WorldEvent[];
  getLastActivityAt: () => number;
  isWorldBusy: (snapshot: WorldDebugSnapshot) => boolean;
  hasInFlightProvider: (snapshot: WorldDebugSnapshot) => boolean;
  applyFinalBoundary: () => void;
}

export class WorldRunSettler {
  private settleCount = 0;
  private settleTimeoutCount = 0;
  private settleStallCount = 0;
  private backgroundDrainTimeoutCount = 0;
  private maxSettleWallMs = 0;
  private maxSettleVirtualMs = 0;
  private maxPumpIterations = 0;
  private finalBoundaryApplied = false;

  constructor(
    private readonly options: WorldRunLabOptions,
    private readonly deps: WorldRunSettlerDependencies,
  ) {}

  get stability(): Pick<
    WorldRunStabilityMetrics,
    | "settleCount"
    | "timeoutCount"
    | "stallCount"
    | "backgroundDrainTimeoutCount"
    | "maxSettleWallMs"
    | "maxSettleVirtualMs"
    | "maxPumpIterations"
  > {
    return {
      settleCount: this.settleCount,
      timeoutCount: this.settleTimeoutCount,
      stallCount: this.settleStallCount,
      backgroundDrainTimeoutCount: this.backgroundDrainTimeoutCount,
      maxSettleWallMs: this.maxSettleWallMs,
      maxSettleVirtualMs: this.maxSettleVirtualMs,
      maxPumpIterations: this.maxPumpIterations,
    };
  }

  async waitForObservableResult(eventSequenceBefore: number): Promise<void> {
    const wallStartedAt = Date.now();
    const virtualStartedAt = this.deps.runtime.clock.now();
    this.settleCount++;
    const timeoutMs = this.options.stepTimeoutMs ?? (
      this.options.providers.mode === "live" ? 120_000 : 10_000
    );
    const pollIntervalMs = this.options.pollIntervalMs ?? 20;
    let iterations = 0;

    while (Date.now() - wallStartedAt < timeoutMs) {
      iterations++;
      await flushMicrotasks();
      if (this.deps.getEvents().some((event) => (
        event.sequence > eventSequenceBefore &&
        isObservableAgentResult(event, this.options.scenario.definition)
      ))) {
        this.recordSettle(wallStartedAt, virtualStartedAt, iterations);
        return;
      }
      const snapshot = this.deps.getWorld().debugSnapshot();
      if (this.deps.manualRuntime) {
        if (this.deps.hasInFlightProvider(snapshot)) {
          await delay(Math.max(10, pollIntervalMs));
          continue;
        }
        const nextDueAt = this.deps.manualRuntime.nextDueAt();
        if (nextDueAt !== undefined) {
          this.deps.manualRuntime.advanceTo(Math.max(
            this.deps.runtime.clock.now(),
            nextDueAt,
          ));
          continue;
        }
      }
      if (!this.deps.isWorldBusy(snapshot)) {
        this.recordSettle(wallStartedAt, virtualStartedAt, iterations);
        return;
      }
      await delay(pollIntervalMs);
    }

    this.maxPumpIterations = Math.max(this.maxPumpIterations, iterations);
    this.settleTimeoutCount++;
    throw new Error(
      `等待首个可见结果超时：${describeBusyState(this.deps.getWorld().debugSnapshot())}`,
    );
  }

  async settle(explicitWaitMs?: number, stopAtTarget = false): Promise<void> {
    if (this.deps.manualRuntime) {
      await this.settleAccelerated(explicitWaitMs, stopAtTarget);
      return;
    }
    await this.settleRealtime(explicitWaitMs, stopAtTarget);
  }

  private async settleRealtime(explicitWaitMs?: number, stopAtTarget = false): Promise<void> {
    const wallStartedAt = Date.now();
    const virtualStartedAt = this.deps.runtime.clock.now();
    this.settleCount++;
    if (explicitWaitMs !== undefined) {
      await delay(explicitWaitMs);
    }
    const quietPeriodMs = this.options.quietPeriodMs ?? (
      this.options.providers.mode === "live" ? 2_000 : 80
    );
    const pollIntervalMs = this.options.pollIntervalMs ?? 20;
    const timeoutMs = this.options.stepTimeoutMs ?? (
      this.options.providers.mode === "live" ? 120_000 : 10_000
    );
    const scheduledDrainGraceMs = Math.max(
      0,
      this.options.scheduledDrainGraceMs ?? (
        this.options.providers.mode === "live" ? 30_000 : 5_000
      ),
    );
    const targetCompletionWindowMs = this.options.providers.mode === "live" ? 750 : 0;
    const startedAt = Date.now();
    let deadline = startedAt + timeoutMs;
    let scheduledDrainExtended = false;
    let iterations = 0;

    while (true) {
      iterations++;
      if (
        stopAtTarget &&
        this.deps.getEvents().length >= this.options.scenario.targetEventCount &&
        !this.finalBoundaryApplied
      ) {
        this.finalBoundaryApplied = true;
        this.deps.applyFinalBoundary();
      }
      const snapshot = this.deps.getWorld().debugSnapshot();
      const events = this.deps.getEvents();
      if (
        events.length >= this.options.scenario.targetEventCount &&
        !hasForegroundProvider(snapshot) &&
        !hasPendingScheduledOutput(snapshot) &&
        Date.now() - this.deps.getLastActivityAt() >= targetCompletionWindowMs
      ) {
        this.recordSettle(wallStartedAt, virtualStartedAt, iterations);
        return;
      }
      if (!this.deps.isWorldBusy(snapshot) && Date.now() - this.deps.getLastActivityAt() >= quietPeriodMs) {
        this.recordSettle(wallStartedAt, virtualStartedAt, iterations);
        return;
      }

      const now = Date.now();
      if (now >= deadline) {
        const nextScheduledWaitMs = nextScheduledOutputWaitMs(snapshot);
        if (
          scheduledDrainGraceMs > 0 &&
          !scheduledDrainExtended &&
          nextScheduledWaitMs !== undefined &&
          nextScheduledWaitMs <= scheduledDrainGraceMs
        ) {
          scheduledDrainExtended = true;
          deadline = now + Math.max(scheduledDrainGraceMs, nextScheduledWaitMs + 1_000);
          continue;
        }
        this.maxPumpIterations = Math.max(this.maxPumpIterations, iterations);
        this.settleTimeoutCount++;
        throw new Error(
          `等待世界收敛超时：${describeBusyState(snapshot)}`,
        );
      }

      await delay(Math.min(pollIntervalMs, Math.max(1, deadline - now)));
    }
  }

  async drainBackgroundWork(): Promise<void> {
    const timeoutMs = this.options.backgroundTimeoutMs ?? (
      this.options.providers.mode === "live" ? 45_000 : 0
    );
    if (timeoutMs <= 0) return;
    const startedAt = Date.now();
    const pollIntervalMs = this.options.pollIntervalMs ?? 20;
    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = this.deps.getWorld().debugSnapshot();
      const memoryIdle = snapshot.memory.every(({ runtime }) => runtime.status === "idle");
      if (memoryIdle && this.deps.manualRuntime) {
        const nextDueAt = this.deps.manualRuntime.nextDueAt();
        if (nextDueAt !== undefined) {
          this.deps.manualRuntime.advanceTo(Math.max(this.deps.runtime.clock.now(), nextDueAt));
          await flushMicrotasks();
          continue;
        }
      }
      if (memoryIdle) return;
      if (this.deps.manualRuntime && !this.deps.hasInFlightProvider(snapshot)) {
        const nextDueAt = this.deps.manualRuntime.nextDueAt();
        if (nextDueAt !== undefined) {
          this.deps.manualRuntime.advanceTo(Math.max(this.deps.runtime.clock.now(), nextDueAt));
          await flushMicrotasks();
          continue;
        }
      }
      await delay(pollIntervalMs);
    }
    this.backgroundDrainTimeoutCount++;
  }

  private async settleAccelerated(explicitWaitMs?: number, stopAtTarget = false): Promise<void> {
    const runtime = this.deps.manualRuntime!;
    const wallStartedAt = Date.now();
    const virtualStartedAt = this.deps.runtime.clock.now();
    this.settleCount++;
    const quietPeriodMs = this.options.quietPeriodMs ?? 0;
    const timeoutMs = this.options.stepTimeoutMs ?? 300_000;
    const maxIterations = this.options.maxPumpIterations ?? 100_000;
    let iterations = 0;
    let unresolvedProviderIterations = 0;

    if (explicitWaitMs !== undefined) {
      runtime.advanceBy(explicitWaitMs);
      await flushMicrotasks();
    }

    while (this.deps.runtime.clock.now() - virtualStartedAt <= timeoutMs) {
      iterations++;
      if (iterations > maxIterations) {
        this.settleTimeoutCount++;
        throw new Error(`加速运行超过泵迭代上限：${maxIterations}`);
      }
      await flushMicrotasks();
      const events = this.deps.getEvents();
      if (
        stopAtTarget &&
        events.length >= this.options.scenario.targetEventCount &&
        !this.finalBoundaryApplied
      ) {
        this.finalBoundaryApplied = true;
        this.deps.applyFinalBoundary();
        await flushMicrotasks();
      }
      const snapshot = this.deps.getWorld().debugSnapshot();
      const now = this.deps.runtime.clock.now();
      const quietFor = now - this.deps.getLastActivityAt();

      if (
        events.length >= this.options.scenario.targetEventCount &&
        !hasForegroundProvider(snapshot) &&
        !hasPendingScheduledOutput(snapshot)
      ) {
        this.recordSettle(wallStartedAt, virtualStartedAt, iterations);
        return;
      }

      const shouldAdvanceFutureWork = (
        stopAtTarget &&
        events.length < this.options.scenario.targetEventCount &&
        runtime.pendingTaskCount() > 0
      );
      if (!this.deps.isWorldBusy(snapshot) && quietFor >= quietPeriodMs && !shouldAdvanceFutureWork) {
        this.recordSettle(wallStartedAt, virtualStartedAt, iterations);
        return;
      }

      if (this.deps.hasInFlightProvider(snapshot)) {
        unresolvedProviderIterations++;
        if (this.options.providers.mode === "live") {
          if (Date.now() - wallStartedAt >= timeoutMs) {
            this.settleStallCount++;
            throw new Error(`加速运行等待真实 Provider 超时：${describeBusyState(snapshot)}`);
          }
          await delay(Math.max(10, this.options.pollIntervalMs ?? 20));
          await flushMicrotasks();
          continue;
        }
        if (unresolvedProviderIterations >= 64) {
          this.settleStallCount++;
          throw new Error("加速运行检测到 Provider promise 长时间没有完成");
        }
        if (unresolvedProviderIterations % 8 === 0) {
          await delay(0);
          await flushMicrotasks();
        }
        continue;
      }

      const nextDueAt = runtime.nextDueAt();
      if (nextDueAt !== undefined) {
        unresolvedProviderIterations = 0;
        runtime.advanceTo(Math.max(now, nextDueAt));
        continue;
      }

      if (!this.deps.isWorldBusy(snapshot)) {
        unresolvedProviderIterations = 0;
        runtime.advanceTo(Math.max(now + 1, this.deps.getLastActivityAt() + quietPeriodMs));
        continue;
      }

      unresolvedProviderIterations++;
      if (unresolvedProviderIterations >= 64) {
        this.settleStallCount++;
        throw new Error(`加速运行检测到无唤醒任务的卡死：${describeBusyState(snapshot)}`);
      }
    }

    this.maxPumpIterations = Math.max(this.maxPumpIterations, iterations);
    this.settleTimeoutCount++;
    const snapshot = this.deps.getWorld().debugSnapshot();
    throw new Error(
      `加速运行超时：virtual=${this.deps.runtime.clock.now() - virtualStartedAt}ms ` +
      describeBusyState(snapshot),
    );
  }

  private recordSettle(
    wallStartedAt: number,
    virtualStartedAt: number,
    iterations: number,
  ): void {
    this.maxSettleWallMs = Math.max(this.maxSettleWallMs, Date.now() - wallStartedAt);
    this.maxSettleVirtualMs = Math.max(
      this.maxSettleVirtualMs,
      this.deps.runtime.clock.now() - virtualStartedAt,
    );
    this.maxPumpIterations = Math.max(this.maxPumpIterations, iterations);
  }
}

export function isInputStep(step: WorldRunStep): boolean {
  return step.type === "message" ||
    step.type === "event" ||
    step.type === "directive" ||
    step.type === "progression";
}

function isObservableAgentResult(event: WorldEvent, definition: WorldRunLabOptions["scenario"]["definition"]): boolean {
  if (
    event.type === "narrative.narration.committed" ||
    event.type === "narrative.beat.recorded" ||
    event.type === "narrative.beat.completed"
  ) return true;
  if (event.type === "context.message.committed") {
    return event.payload.message.source === "character";
  }
  if (event.type === "context.action.committed") {
    return definition.actors.some((actor) => (
      actor.id === event.actorId && actor.kind === "character"
    ));
  }
  return false;
}

function hasForegroundProvider(snapshot: WorldDebugSnapshot): boolean {
  if (snapshot.director.running) return true;
  return snapshot.contexts.some((context) => {
    if (context.presentation && context.presentation.status !== "waiting_player" && context.presentation.status !== "waiting_ack") return true;
    const session = context.session as {
      queues?: { generating?: unknown[] };
    };
    return Boolean(session.queues?.generating?.length);
  });
}

function hasPendingScheduledOutput(snapshot: WorldDebugSnapshot): boolean {
  return nextScheduledOutputWaitMs(snapshot) !== undefined;
}

function nextScheduledOutputWaitMs(snapshot: WorldDebugSnapshot): number | undefined {
  let nextWaitMs: number | undefined;
  for (const context of snapshot.contexts) {
    const session = context.session as {
      queues?: { scheduled?: Array<{ remainingSec?: number }> };
    };
    for (const message of session.queues?.scheduled ?? []) {
      if (typeof message.remainingSec !== "number" || !Number.isFinite(message.remainingSec)) continue;
      const waitMs = Math.max(0, message.remainingSec * 1_000);
      nextWaitMs = nextWaitMs === undefined ? waitMs : Math.min(nextWaitMs, waitMs);
    }
  }
  return nextWaitMs;
}

function describeBusyState(snapshot: WorldDebugSnapshot): string {
  const contexts = snapshot.contexts.map((context) => {
    const session = context.session as {
      queues?: {
        scheduled?: unknown[];
        generating?: unknown[];
        triggers?: unknown[];
      };
    };
    return `${context.contextId}:scheduled=${session.queues?.scheduled?.length ?? 0},` +
      `generating=${session.queues?.generating?.length ?? 0},` +
      `triggers=${session.queues?.triggers?.length ?? 0}`;
  });
  const memory = snapshot.memory
    .filter(({ runtime }) => runtime.status !== "idle")
    .map(({ runtime }) => `${runtime.actorId}:${runtime.status}`);
  const director = snapshot.director.running
    ? "running"
    : snapshot.director.dueAt !== undefined
      ? `scheduled@${snapshot.director.dueAt}`
      : "idle";
  return `director=${director}; memory=${memory.join(",") || "idle"}; contexts=${contexts.join(" | ")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}
