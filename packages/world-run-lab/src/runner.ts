import {
  ChatVerse,
  InProcessRuntimeHost,
  ManualRuntimeHost,
  type World,
  type WorldEvent,
  type WorldNotification,
  type WorldSnapshot,
} from "@chatverse/core";
import type { RuntimeHost } from "@chatverse/core";
import { buildMetrics, buildTranscript } from "./metrics.js";
import {
  createPromptTraceState,
  createPromptTracingProvider,
} from "./prompt-trace.js";
import { WorldRunObserver } from "./observer.js";
import type {
  WorldRunCheckContext,
  WorldRunCheckResult,
  WorldRunCheckpoint,
  WorldRunDebugRecord,
  WorldRunLabOptions,
  WorldRunOperationRecord,
  WorldRunProgress,
  WorldRunPromptTrace,
  WorldRunReport,
  WorldRunStep,
  WorldRunStepResult,
} from "./types.js";
import {
  asFastForwardRuntime,
  isInputStep,
  WorldRunSettler,
  type FastForwardRuntime,
} from "./settlement.js";
import {
  createRunId,
  errorMessage,
  flushMicrotasks,
} from "./runner-helpers.js";
const DEFAULT_DEBUG = {
  enabled: true,
  tracePrompts: false,
  traceResponses: false,
  traceToolCalls: true,
  includeMemoryContent: true,
  maxEvents: 10_000,
} as const;
export class WorldRunLab {
  private readonly runtime: RuntimeHost;
  private readonly manualRuntime?: FastForwardRuntime;
  private readonly timeMode: "realtime" | "accelerated";
  private readonly chatverse;
  private readonly events: WorldEvent[] = [];
  private readonly eventIds = new Set<string>();
  private readonly notifications: WorldNotification[] = [];
  private readonly debug: WorldRunDebugRecord[] = [];
  private readonly operations: WorldRunOperationRecord[] = [];
  private readonly promptTraces: WorldRunPromptTrace[] = [];
  private readonly promptTraceState = createPromptTraceState();
  private readonly checkpoints: WorldRunCheckpoint[] = [];
  private readonly stepResults: WorldRunStepResult[] = [];
  private readonly errors: string[] = [];
  private readonly settler: WorldRunSettler;
  private readonly checkpointTargets: number[];
  private readonly unsubscribers: Array<() => void> = [];
  private readonly observer: WorldRunObserver;
  private world: World;
  private runtimeGeneration = 1;
  private lastActivityAt: number;
  constructor(private readonly options: WorldRunLabOptions) {
    this.timeMode = options.timeMode ?? "realtime";
    const runtime = options.runtime ?? (
      this.timeMode === "accelerated"
        ? new ManualRuntimeHost(0)
        : new InProcessRuntimeHost()
    );
    this.runtime = runtime;
    this.manualRuntime = this.timeMode === "accelerated"
      ? asFastForwardRuntime(runtime)
      : undefined;
    if (this.timeMode === "accelerated" && !this.manualRuntime) {
      throw new Error(
        "加速模式需要 ManualRuntimeHost，或提供 advanceTo/nextDueAt/pendingTaskCount 的 RuntimeHost。",
      );
    }
    this.lastActivityAt = this.runtime.clock.now();
    this.chatverse = new ChatVerse({
      directorProvider: createPromptTracingProvider(
        options.providers.director,
        "director",
        this.promptTraces,
        this.promptTraceState,
        (trace, lifecycle) => this.reportProviderProgress(trace, lifecycle),
      ),
      characterProvider: createPromptTracingProvider(
        options.providers.character,
        "character",
        this.promptTraces,
        this.promptTraceState,
        (trace, lifecycle) => this.reportProviderProgress(trace, lifecycle),
      ),
      runtime: this.runtime,
    });
    this.checkpointTargets = [...new Set(options.scenario.checkpointSequences)]
      .filter((value) => Number.isInteger(value) && value > 0)
      .sort((left, right) => left - right);
    this.world = this.createWorld(options.initialSnapshot);
    this.observer = new WorldRunObserver({
      host: {
        progress: (progress) => this.progress(progress),
        getEventSequence: () => this.world?.snapshot().eventSequence,
      },
      notifications: this.notifications,
      operations: this.operations,
      errors: this.errors,
    });
    this.settler = new WorldRunSettler(options, {
      runtime: this.runtime,
      manualRuntime: this.manualRuntime,
      getWorld: () => this.world,
      getEvents: () => this.events,
      getLastActivityAt: () => this.lastActivityAt,
      isWorldBusy: (snapshot) => this.observer.isWorldBusy(snapshot),
      hasInFlightProvider: (snapshot) => this.observer.hasInFlightProvider(snapshot),
      applyFinalBoundary: () => this.applyFinalBoundary(),
    });
    this.syncSnapshotEvents(this.world.snapshot());
    this.bindWorld();
  }
  async run(): Promise<WorldRunReport> {
    const startedAt = Date.now();
    this.progress({ phase: "starting", message: `启动基准：${this.options.scenario.name}` });
    this.world.start();
    let stoppedAfterFailure = false;
    for (let index = 0; index < this.options.scenario.steps.length; index++) {
      if (
        !this.options.scenario.runAllSteps &&
        this.events.length >= this.options.scenario.targetEventCount
      ) break;
      const step = this.options.scenario.steps[index]!;
      const before = this.world.snapshot().eventSequence;
      const stepStartedAt = Date.now();
      this.progress({
        phase: "step",
        stepIndex: index,
        eventSequence: before,
        message: step.label,
      });
      try {
        await this.executeStep(step);
        await this.completeStep(step, before);
        await this.captureDueCheckpoints();
        this.stepResults.push({
          index,
          id: step.id,
          label: step.label,
          type: step.type,
          startedAt: stepStartedAt,
          finishedAt: Date.now(),
          eventSequenceBefore: before,
          eventSequenceAfter: this.world.snapshot().eventSequence,
          status: "passed",
        });
        if (this.options.scenario.stopWhen?.({
          events: this.events,
          snapshot: this.world.snapshot(),
        })) break;
      } catch (error) {
        const message = errorMessage(error);
        this.errors.push(`步骤“${step.label}”失败：${message}`);
        this.stepResults.push({
          index,
          id: step.id,
          label: step.label,
          type: step.type,
          startedAt: stepStartedAt,
          finishedAt: Date.now(),
          eventSequenceBefore: before,
          eventSequenceAfter: this.world.snapshot().eventSequence,
          status: "failed",
          error: message,
        });
        this.progress({ phase: "failed", stepIndex: index, message });
        // A failed real request may leave a provider promise waiting on the
        // network. Stop the World before building the report so the lab does
        // not enter a second full settle timeout and the report is durable.
        this.world.stop();
        stoppedAfterFailure = true;
        break;
      }
    }
    if (!stoppedAfterFailure) {
      try {
        await this.settler.settle(undefined, true);
        await this.captureDueCheckpoints();
        await this.settler.drainBackgroundWork();
      } catch (error) {
        this.errors.push(`最终收敛失败：${errorMessage(error)}`);
        this.world.stop();
        stoppedAfterFailure = true;
      }
    }
    // Freeze the run before taking the report snapshot. Besides cancelling
    // scheduled work, this closes any lifecycle operation that raced with the
    // last settle check, so the report cannot say both "active=1" and
    // "cancelled" for the same final request.
    this.world.stop();
    const finalSnapshot = this.world.snapshot();
    this.syncSnapshotEvents(finalSnapshot);
    this.observer.recordUnrecoveredRuntimeErrors();
    const metrics = buildMetrics({
      events: this.events,
      notifications: this.notifications,
      debug: this.debug,
      checkpointCount: this.checkpoints.length,
      restoreCount: this.checkpoints.filter((checkpoint) => checkpoint.restored).length,
      stability: {
        timeMode: this.timeMode,
        ...this.settler.stability,
        finalPendingTasks: this.manualRuntime?.pendingTaskCount() ?? 0,
        ...this.observer.stability,
      },
    });
    const checkContext: WorldRunCheckContext = {
      scenario: this.options.scenario,
      events: this.events,
      notifications: this.notifications,
      debug: this.debug,
      operations: this.operations,
      promptTraces: this.promptTraces,
      checkpoints: this.checkpoints,
      finalSnapshot,
      metrics,
    };
    const checks = this.evaluateChecks(checkContext);
    const finishedAt = Date.now();
    const status = this.errors.length === 0 && checks.every((check) => check.passed)
      ? "passed"
      : "failed";
    this.unbindWorld();
    // Measure scheduler cleanup after the World has cancelled its lifecycle,
    // ambient, Director, and memory tasks. A pre-stop count is useful while
    // diagnosing a run, but it is not a leak by itself.
    if (this.manualRuntime) {
      metrics.stability.finalPendingTasks = this.manualRuntime.pendingTaskCount();
    }
    this.progress({
      phase: status === "passed" ? "completed" : "failed",
      eventSequence: finalSnapshot.eventSequence,
      message: status === "passed" ? "基准通过" : "基准未通过",
    });
    return {
      schemaVersion: 1,
      runId: createRunId(this.options.scenario.id, startedAt),
      scenario: {
        id: this.options.scenario.id,
        name: this.options.scenario.name,
        description: this.options.scenario.description,
        providerMode: this.options.providers.mode,
        timeMode: this.timeMode,
        directorBatchSize: this.options.scenario.definition.directorPolicy?.batchSize ?? 8,
        targetEventCount: this.options.scenario.targetEventCount,
      },
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      steps: this.stepResults,
      checkpoints: this.checkpoints,
      events: this.events,
      notifications: this.notifications,
      debug: this.debug,
      operations: this.operations,
      promptTraces: this.promptTraces,
      transcript: buildTranscript(this.events),
      metrics,
      checks,
      errors: this.errors,
      finalSnapshot,
    };
  }

  private createWorld(snapshot?: WorldSnapshot): World {
    const definition = this.options.directorReasoning === undefined
      ? this.options.scenario.definition
      : {
          ...this.options.scenario.definition,
          directorPolicy: {
            ...this.options.scenario.definition.directorPolicy,
            reasoning: this.options.directorReasoning,
          },
        };
    return this.chatverse.createWorld(definition, {
      snapshot,
      sourceProvider: this.options.sourceProvider,
      debug: this.options.debug ?? DEFAULT_DEBUG,
      ...(this.options.timelineCuratorMinRows !== undefined
        ? { timelineCuratorMinRows: this.options.timelineCuratorMinRows }
        : {}),
    });
  }

  private bindWorld(): void {
    this.unsubscribers.push(
      this.world.onEvent((event) => {
        if (!this.eventIds.has(event.id)) {
          this.eventIds.add(event.id);
          this.events.push(event);
        }
        this.markActivity();
      }),
      this.world.onNotification((notification) => {
        this.notifications.push(notification);
        this.observer.trackNotification(notification);
        this.markActivity();
      }),
      this.world.onDebug((event) => {
        this.debug.push({
          runtimeGeneration: this.runtimeGeneration,
          event,
        });
        this.observer.trackDebugEvent(event);
        this.markActivity();
      }),
    );
  }

  private unbindWorld(): void {
    while (this.unsubscribers.length) {
      this.unsubscribers.pop()?.();
    }
  }

  private manualSnapshot?: WorldSnapshot;

  private async executeStep(step: WorldRunStep): Promise<void> {
    switch (step.type) {
      case "progression":
        this.world.requestProgression({
          contextId: step.contextId,
          reason: step.reason,
        });
        return;
      case "message":
        if (this.submitMessageIntoPendingPlayerTurn(step)) return;
        this.world.sendMessage({
          contextId: step.contextId,
          actorId: step.actorId,
          message: step.message,
        });
        return;
      case "player_turn":
        await this.executePlayerTurnStep(step);
        return;
      case "directive":
        this.world.changeDirection({
          contextId: step.contextId,
          direction: step.instruction,
        });
        return;
      case "event":
        this.world.emitEvent({
          message: step.message,
          contextIds: step.contextIds,
          actorIds: step.actorIds,
        });
        return;
      case "wait":
        return;
      case "pause":
        this.world.pause();
        return;
      case "resume":
        this.world.resume();
        return;
      case "snapshot":
        this.manualSnapshot = this.world.snapshot();
        return;
      case "restore":
        if (!this.manualSnapshot) throw new Error("尚未创建手动恢复点。");
        await this.restoreSnapshot(this.manualSnapshot, "手动恢复点");
        return;
    }
  }

  private async executePlayerTurnStep(
    step: Extract<WorldRunStep, { type: "player_turn" }>,
  ): Promise<void> {
    let presentation = this.world.snapshot().presentationRuntime?.find(
      (runtime) => runtime.contextId === step.contextId,
    );
    if (presentation?.current?.status !== "waiting_player") {
      await this.settler.settle();
      presentation = this.world.snapshot().presentationRuntime?.find(
        (runtime) => runtime.contextId === step.contextId,
      );
    }
    const turn = presentation?.current;
    if (!turn || turn.status !== "waiting_player" || turn.participant.type !== "player") {
      if (step.optional) return;
      throw new Error(`步骤“${step.label}”需要一个待处理的玩家回合。`);
    }
    if (turn.participant.actorId !== step.actorId) {
      throw new Error(
        `玩家回合属于 ${turn.participant.actorId}，但脚本指定了 ${step.actorId}。`,
      );
    }
    const proposal = presentation?.playerProposal;
    const proposalId = step.proposalId ?? proposal?.id;
    if (step.mode === "skip") {
      this.world.submitPlayerTurn({
        contextId: step.contextId,
        actorId: step.actorId,
        ...(proposalId ? { proposalId } : {}),
        skip: true,
      });
      return;
    }
    const performance = step.performance ?? (
      step.mode === "auto" || step.mode === undefined
        ? proposal?.autoPerformance.performance
        : undefined
    );
    if (!performance) {
      throw new Error(`步骤“${step.label}”没有可提交的玩家表演。`);
    }
    this.world.submitPlayerTurn({
      contextId: step.contextId,
      actorId: step.actorId,
      ...(proposalId ? { proposalId } : {}),
      performance,
    });
  }

  private async completeStep(step: WorldRunStep, eventSequenceBefore: number): Promise<void> {
    if (step.type === "wait") {
      await this.settler.settle(step.durationMs);
      return;
    }
    const completion = step.completion ?? this.options.stepCompletion ?? "settled";
    if (completion === "immediate") {
      await flushMicrotasks();
      return;
    }
    if (completion === "observable" && isInputStep(step)) {
      await this.settler.waitForObservableResult(eventSequenceBefore);
      return;
    }
    await this.settleWithContinuousPresentation();
  }

  /**
   * Advance a bounded number of visible turns, then stop at the next
   * presentation boundary. This can reveal a buffered player proposal without
   * allowing one benchmark step to launch an unlimited autonomous run.
   */
  private async settleWithContinuousPresentation(): Promise<void> {
    const ackBudget = Math.max(0, this.options.maxPresentationAcksPerStep ?? 1);
    for (let acknowledged = 0; acknowledged < ackBudget; acknowledged++) {
      await this.settler.settle();
      const didAcknowledge = await this.acknowledgeVisiblePresentationTurns();
      if (!didAcknowledge) return;
      await flushMicrotasks();
    }
    await this.settler.settle();
  }

  private async acknowledgeVisiblePresentationTurns(): Promise<boolean> {
    let acknowledged = false;
    for (const presentation of this.world.snapshot().presentationRuntime ?? []) {
      const turn = presentation.current;
      if (!turn || turn.status !== "waiting_ack") continue;
      const waitMs = Math.max(0, (turn.acknowledgeAfter ?? 0) - this.runtime.clock.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const result = this.world.acknowledgePresentation({
        contextId: presentation.contextId,
        turnToken: turn.turnToken,
      });
      if (result === "accepted") acknowledged = true;
    }
    return acknowledged;
  }

  /** A scripted player message is the player's performance when a gate is open. */
  private submitMessageIntoPendingPlayerTurn(
    step: Extract<WorldRunStep, { type: "message" }>,
  ): boolean {
    const presentation = this.world.snapshot().presentationRuntime?.find(
      (runtime) => runtime.contextId === step.contextId,
    );
    const turn = presentation?.current;
    if (
      !turn
      || turn.status !== "waiting_player"
      || turn.participant.type !== "player"
      || turn.participant.actorId !== step.actorId
    ) return false;
    this.world.submitPlayerTurn({
      contextId: step.contextId,
      actorId: step.actorId,
      ...(presentation.playerProposal?.id
        ? { proposalId: presentation.playerProposal.id }
        : {}),
      performance: { message: step.message },
    });
    return true;
  }

  private applyFinalBoundary(): void {
    for (const context of this.options.scenario.definition.contexts) {
      this.world.suspendContext(context.id);
    }
  }

  private async captureDueCheckpoints(): Promise<void> {
    while (this.checkpointTargets.length) {
      const next = this.checkpointTargets[0]!;
      const sequence = this.world.snapshot().eventSequence;
      if (sequence < next) return;
      this.checkpointTargets.shift();
      await this.restoreAtCheckpoint(next);
    }
  }

  private async restoreAtCheckpoint(requestedSequence: number): Promise<void> {
    const snapshot = this.world.snapshot();
    this.progress({
      phase: "checkpoint",
      eventSequence: snapshot.eventSequence,
      message: `冷恢复 checkpoint ${requestedSequence}`,
    });
    await this.restoreSnapshot(snapshot, `checkpoint ${requestedSequence}`);
    this.checkpoints.push({
      requestedSequence,
      capturedSequence: snapshot.eventSequence,
      capturedAt: this.runtime.clock.now(),
      restored: true,
      snapshot,
    });
    this.markActivity();
    await this.settler.settle();
  }

  private async restoreSnapshot(snapshot: WorldSnapshot, label: string): Promise<void> {
    this.progress({
      phase: "checkpoint",
      eventSequence: snapshot.eventSequence,
      message: `恢复 ${label}`,
    });
    this.observer.finishAllOperations(this.runtime.clock.now(), "cancelled");
    this.unbindWorld();
    this.world.stop();
    this.runtimeGeneration++;
    this.world = this.createWorld(snapshot);
    this.bindWorld();
    this.world.start();
  }

  private syncSnapshotEvents(snapshot: WorldSnapshot): void {
    for (const event of snapshot.events) {
      if (this.eventIds.has(event.id)) continue;
      this.eventIds.add(event.id);
      this.events.push(event);
    }
    this.events.sort((left, right) => left.sequence - right.sequence);
  }

  private evaluateChecks(context: WorldRunCheckContext): WorldRunCheckResult[] {
    return (this.options.scenario.checks ?? []).map((check) => {
      try {
        return {
          id: check.id,
          label: check.label,
          ...check.evaluate(context),
        };
      } catch (error) {
        return {
          id: check.id,
          label: check.label,
          passed: false,
          detail: `检查器异常：${errorMessage(error)}`,
        };
      }
    });
  }

  private markActivity(): void {
    this.lastActivityAt = this.runtime.clock.now();
  }

  private progress(progress: WorldRunProgress): void {
    try {
      this.options.onProgress?.(progress);
    } catch {
      // Progress output cannot affect the benchmark.
    }
  }

  private reportProviderProgress(
    trace: WorldRunPromptTrace,
    lifecycle: "started" | "completed" | "error",
  ): void {
    const detail = lifecycle === "started"
      ? `${trace.provider}/${trace.purpose ?? trace.operation} started`
      : `${trace.provider}/${trace.purpose ?? trace.operation} ${lifecycle} in ${trace.durationMs}ms`;
    this.progress({
      phase: "provider",
      eventSequence: this.world?.snapshot().eventSequence,
      message: `${trace.id} ${detail}`,
    });
  }
}
