import type {
  NarrativeBeat,
  ResolvedWorldDirectorPolicy,
  WorldEvent,
} from "../../../contracts/world.js";
import type { RuntimeHost, RuntimeTask } from "../../../runtime/types.js";
import type { WorldDebugSnapshot } from "../../../contracts/world-debug.js";
import { WorldDirector } from "../director/agent.js";
import type {
  WorldDirectorHost,
  WorldDirectorTrace,
} from "../director/types.js";
import type { WorldDirectorMutation, WorldDirectorTaskMode } from "../director/index.js";
import type { DirectorTaskBuilder } from "../hosts/director-task.js";
import type { DirectorViewBuilder } from "../hosts/director-view.js";
import type { WorldState } from "../state.js";
import {
  createDebugTaskState,
  errorToMessage,
  isDirectorInputEvent,
  isImmediateDirectorInputEvent,
} from "./helpers.js";

const DIRECTOR_PROVIDER_RETRY_DELAY_MS = 5_000;

export interface DirectorPlanRun {
  id: string;
  rootEventIds: string[];
  reasons: string[];
  contextIds: string[];
  taskMode?: WorldDirectorTaskMode;
  objective?: string;
  sourceEventIds?: string[];
}

type DirectorTaskState = WorldDebugSnapshot["director"]["task"];

export interface DirectorRuntimeHost {
  state: WorldState;
  policy: ResolvedWorldDirectorPolicy;
  runtime: RuntimeHost;
  director: WorldDirector;
  directorTaskBuilder: DirectorTaskBuilder;
  directorViewBuilder: DirectorViewBuilder;
  createDirectorHost(): WorldDirectorHost;
  traceDirector(event: WorldDirectorTrace): void;
  isRunning(): boolean;
  isPaused(): boolean;
  isStopped(): boolean;
  lifecycleEpoch(): number;
  isWorldEventOwnedByActiveBeat(event: WorldEvent): boolean;
  isDeferredWhileBeatRuns(event: WorldEvent): boolean;
  notify(type: string, payload: Record<string, unknown>): void;
  expectDirectorForeground(contextId: string, transition: boolean, expectedAt?: number): void;
  startDirectorForeground(contextId: string): void;
  clearDirectorForeground(contextId: string): void;
  failDirectorForeground(
    contextId: string,
    kind: "task_incomplete" | "provider",
    message: string,
    userMessage?: string,
    retryable?: boolean,
  ): void;
  retryDirectorForeground(
    contextIds: readonly string[],
    kind: "task_incomplete" | "provider",
    message: string,
    retryDelayMs: number,
  ): boolean;
  handleProviderFailure(error: unknown): boolean;
  applyDirectorMutations(
    mutations: readonly WorldDirectorMutation[],
    batchEvents: readonly WorldEvent[],
    taskMode?: WorldDirectorTaskMode,
  ): Set<string>;
  recordAmbientNoop(contextId: string): void;
  shouldRecordAmbientNoop(contextId: string): boolean;
}

/** Owns Director plans, scheduling, retries, and the single active model call. */
export class DirectorRuntime {
  private task?: RuntimeTask;
  private running = false;
  private immediatePending = false;
  // Diagnostic only. Retry scheduling is owned by ForegroundRecoveryController.
  private retryIndex = 0;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private abortController?: AbortController;
  private pendingReason = "event_batch";
  private dueAt?: number;
  private taskState?: DirectorTaskState;
  private plan?: DirectorPlanRun;

  constructor(private readonly host: DirectorRuntimeHost) {}

  get isRunning(): boolean {
    return this.running;
  }

  get planState(): DirectorPlanRun | undefined {
    return this.plan;
  }

  get debugState(): {
    running: boolean;
    dueAt?: number;
    retryIndex: number;
    lastRunAt: number;
    task?: DirectorTaskState;
  } {
    return {
      running: this.running,
      dueAt: this.dueAt,
      retryIndex: this.retryIndex,
      lastRunAt: this.lastRunAt,
      task: this.taskState,
    };
  }

  consider(immediate: boolean): void {
    if (!this.host.policy.enabled || !this.host.isRunning()) return;
    const pending = this.collectBatch();
    if (pending.events.length === 0) {
      if (pending.consumedThrough > this.host.state.directorCursor) {
        this.host.state.directorCursor = pending.consumedThrough;
      }
      return;
    }
    if (!immediate && pending.events.every((event) => this.host.isDeferredWhileBeatRuns(event))) {
      return;
    }
    const hasImmediateEvent = pending.events.some(isImmediateDirectorInputEvent);
    if (immediate || hasImmediateEvent) {
      this.schedule(true, "important_event");
    } else if (pending.events.length >= this.host.policy.batchSize) {
      this.schedule(false, "event_batch");
    }
  }

  scheduleTransition(
    contextId: string,
    beat: NarrativeBeat,
    request: { objective: string; reason: string },
    sourceEventIds: readonly string[],
  ): void {
    const plan = this.ensurePlan("narrator_transition");
    plan.taskMode = "transition_beat";
    plan.objective = request.objective;
    plan.sourceEventIds = [...new Set(sourceEventIds)];
    plan.contextIds = unique([...plan.contextIds, contextId]);
    plan.rootEventIds = unique([...plan.rootEventIds, ...sourceEventIds]);
    this.host.notify("narrator.director_requested", {
      contextId,
      beatId: beat.id,
      kind: "transition_beat",
      objective: request.objective,
      reason: request.reason,
    });
    this.schedule(true, "narrator_transition");
  }

  pause(): void {
    if (this.running) {
      this.immediatePending = true;
      this.abortController?.abort();
    }
    if (this.task) this.immediatePending = true;
    this.task?.cancel();
    this.task = undefined;
    this.dueAt = undefined;
  }

  resume(): void {
    if (this.immediatePending) {
      this.immediatePending = false;
      this.schedule(true, this.pendingReason);
    } else {
      this.consider(false);
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = undefined;
    this.task?.cancel();
    this.task = undefined;
    this.dueAt = undefined;
    this.plan = undefined;
    this.immediatePending = false;
  }

  abort(): void {
    this.abortController?.abort();
    this.task?.cancel();
    this.task = undefined;
    this.dueAt = undefined;
  }

  pendingEventCount(): number {
    return this.collectBatch().events.length;
  }

  private ensurePlan(reason: string): DirectorPlanRun {
    if (this.plan) {
      if (!this.plan.reasons.includes(reason)) this.plan.reasons.push(reason);
      return this.plan;
    }
    this.plan = {
      id: `director-plan:${this.host.runtime.idGenerator.next()}`,
      rootEventIds: [],
      reasons: [reason],
      contextIds: [],
    };
    return this.plan;
  }

  schedule(immediate: boolean, reason = "event_batch"): void {
    if (!this.host.policy.enabled || this.host.isStopped()) return;
    const plan = this.ensurePlan(reason);
    if (this.host.isPaused()) {
      this.immediatePending ||= immediate;
      if (immediate) this.pendingReason = reason;
      return;
    }
    if (!this.host.isRunning()) return;
    if (this.running) {
      this.immediatePending ||= immediate;
      if (immediate) this.pendingReason = reason;
      return;
    }
    if (!immediate && this.task) return;
    this.task?.cancel();
    const now = this.host.runtime.clock.now();
    const earliestByInterval = this.lastRunAt + this.host.policy.minIntervalMs;
    const requestedAt = now + (immediate ? 0 : this.host.policy.debounceMs);
    const delay = Math.max(0, Math.max(earliestByInterval, requestedAt) - now);
    this.dueAt = now + delay;
    this.pendingReason = reason;
    this.host.notify("director.scheduled", {
      dueAt: this.dueAt,
      delayMs: delay,
      reason,
      planId: plan.id,
      taskMode: plan.taskMode,
    });
    for (const contextId of plan.contextIds) {
      this.host.expectDirectorForeground(
        contextId,
        plan.taskMode === "transition_beat",
        this.dueAt,
      );
    }
    this.task = this.host.runtime.scheduler.schedule(delay, () => {
      this.task = undefined;
      this.dueAt = undefined;
      void this.run();
    });
  }

  private async run(): Promise<void> {
    if (this.running || !this.host.isRunning()) return;
    const plan = this.plan;
    if (!plan) return;
    const batch = this.collectBatch();
    const hasExplicitDirectorTask = plan.taskMode === "transition_beat";
    const batchEvents = hasExplicitDirectorTask
      ? plan.rootEventIds
        .map((eventId) => this.host.state.journal.get(eventId))
        .filter((event): event is WorldEvent => Boolean(event))
      : batch.events;
    if (batchEvents.length === 0) {
      this.host.state.directorCursor = Math.max(
        this.host.state.directorCursor,
        batch.consumedThrough,
      );
      for (const contextId of plan.contextIds) this.host.clearDirectorForeground(contextId);
      this.plan = undefined;
      return;
    }
    plan.rootEventIds = unique([
      ...plan.rootEventIds,
      ...batchEvents.map((event) => event.id),
    ]);
    plan.contextIds = unique([
      ...plan.contextIds,
      ...batchEvents
        .map((event) => event.contextId)
        .filter((id): id is string => Boolean(id)),
    ]);

    for (const contextId of plan.contextIds) {
      this.host.expectDirectorForeground(
        contextId,
        plan.taskMode === "transition_beat",
      );
    }
    this.running = true;
    for (const contextId of plan.contextIds) this.host.startDirectorForeground(contextId);
    const epoch = this.host.lifecycleEpoch();
    const controller = new AbortController();
    this.abortController = controller;
    const task = this.host.directorTaskBuilder.build(batchEvents, plan);
    const progressionRequired = hasExplicitDirectorTask
      ? true
      : this.isProgressionRequired(batchEvents);
    this.taskState = task ? createDebugTaskState(task) : undefined;
    this.host.notify("director.started", {
      fromSequence: this.host.state.directorCursor + 1,
      throughSequence: hasExplicitDirectorTask
        ? this.host.state.directorCursor
        : batch.consumedThrough,
      eventCount: batchEvents.length,
      objective: task?.objective,
      requiredToolNames: task?.requiredToolNames,
      taskMode: task?.mode,
      planId: plan.id,
    });
    try {
      const view = this.host.directorViewBuilder.build(batchEvents, task);
      const result = await this.host.director.run(
        view,
        this.host.createDirectorHost(),
        controller.signal,
        (event) => this.host.traceDirector(event),
        {
          planId: plan.id,
          progressionRequired,
        },
      );
      if (
        controller.signal.aborted ||
        !this.host.isRunning() ||
        epoch !== this.host.lifecycleEpoch()
      ) return;

      const ambientContextIds = new Set(
        batchEvents
          .filter((event) => (
            event.type === "world.progression.requested" &&
            event.payload.reason === "ambient" &&
            Boolean(event.contextId)
          ))
          .map((event) => event.contextId!),
      );
      const progressedContexts = this.host.applyDirectorMutations(
        result.mutations,
        batchEvents,
        task?.mode ?? plan.taskMode,
      );
      for (const contextId of ambientContextIds) {
        if (result.mutations.length > 0) progressedContexts.add(contextId);
        if (!progressedContexts.has(contextId)) {
          this.host.recordAmbientNoop(contextId);
        } else if (this.host.shouldRecordAmbientNoop(contextId)) {
          this.host.recordAmbientNoop(contextId);
        }
      }
      this.lastRunAt = this.host.runtime.clock.now();
      if (this.taskState && result.taskStatus) {
        this.taskState = {
          ...this.taskState,
          status: result.taskStatus,
          retryCount: result.taskRetryCount,
          toolNames: [...result.toolNames],
          failedToolNames: [...result.failedToolNames],
          missingToolNames: [...result.missingToolNames],
        };
      }
      this.host.notify("director.completed", {
        throughSequence: hasExplicitDirectorTask || (
          progressionRequired &&
          result.taskStatus !== undefined &&
          result.taskStatus !== "complete"
        )
          ? this.host.state.directorCursor
          : batch.consumedThrough,
        mutationCount: result.mutations.length,
        toolNames: result.toolNames,
        failedToolNames: result.failedToolNames,
        taskStatus: result.taskStatus,
        taskRetryCount: result.taskRetryCount,
        missingToolNames: result.missingToolNames,
        planId: plan.id,
      });
      const incompleteProgression = (
        progressionRequired &&
        result.taskStatus !== undefined &&
        result.taskStatus !== "complete"
      );
      const incompleteRetryScheduled = incompleteProgression
        ? this.host.retryDirectorForeground(
            plan.contextIds,
            "task_incomplete",
            `Director finished without the required mutation: ${result.taskStatus}.`,
            0,
          )
        : false;
      if (incompleteRetryScheduled) {
        const retryIndex = this.retryIndex + 1;
        this.retryIndex = retryIndex;
        this.host.notify("director.retry_scheduled", {
          retryMs: 0,
          retryIndex,
          maxRetries: this.host.policy.maxProviderRetries,
          planId: plan.id,
        });
        this.pendingReason = "incomplete_progression";
        this.dueAt = this.host.runtime.clock.now();
      } else {
        const taskFailed = Boolean(
          progressionRequired && result.taskStatus && result.taskStatus !== "complete",
        );
        for (const contextId of plan.contextIds) {
          if (taskFailed) {
            this.host.failDirectorForeground(
              contextId,
              "task_incomplete",
              `Director finished without the required mutation: ${result.taskStatus}.`,
            );
          } else {
            this.host.clearDirectorForeground(contextId);
          }
        }
        if (!taskFailed && !hasExplicitDirectorTask) {
          this.host.state.directorCursor = batch.consumedThrough;
        }
        this.retryIndex = 0;
        if (!taskFailed) this.plan = undefined;
      }
    } catch (error) {
      if (controller.signal.aborted || this.host.isStopped()) return;
      if (this.host.handleProviderFailure(error)) {
        for (const contextId of plan.contextIds) {
          this.host.failDirectorForeground(
            contextId,
            "provider",
            errorToMessage(error),
            "模型连接需要处理，修复配置后可重试剧情推进。",
            false,
          );
        }
        return;
      }
      this.host.notify("director.error", { message: errorToMessage(error) });
      if (this.taskState) this.taskState = { ...this.taskState, status: "error" };
      const providerRetryScheduled = this.host.retryDirectorForeground(
        plan.contextIds,
        "provider",
        errorToMessage(error),
        DIRECTOR_PROVIDER_RETRY_DELAY_MS,
      );
      if (providerRetryScheduled) {
        const retryIndex = this.retryIndex + 1;
        this.retryIndex = retryIndex;
        this.host.notify("director.retry_scheduled", {
          retryMs: DIRECTOR_PROVIDER_RETRY_DELAY_MS,
          retryIndex,
          maxRetries: this.host.policy.maxProviderRetries,
          planId: plan.id,
        });
        this.dueAt = this.host.runtime.clock.now() + DIRECTOR_PROVIDER_RETRY_DELAY_MS;
      } else {
        for (const contextId of plan.contextIds) {
          this.host.failDirectorForeground(
            contextId,
            "provider",
            errorToMessage(error),
          );
        }
        this.retryIndex = 0;
      }
    } finally {
      if (this.abortController === controller) this.abortController = undefined;
      this.running = false;
      const immediatePending = this.immediatePending;
      this.immediatePending = false;
      if (!this.task) {
        if (immediatePending) this.schedule(true, this.pendingReason);
        else if (!this.plan) this.consider(false);
      }
    }
  }

  private collectBatch(): { events: WorldEvent[]; consumedThrough: number } {
    const events: WorldEvent[] = [];
    let consumedThrough = this.host.state.directorCursor;
    for (const event of this.host.state.journal.read(this.host.state.directorCursor)) {
      if (events.length >= this.host.policy.maxBatchSize) break;
      consumedThrough = event.sequence;
      if (
        isDirectorInputEvent(event) &&
        !this.host.isWorldEventOwnedByActiveBeat(event)
      ) {
        events.push(event);
      }
    }
    return { events, consumedThrough };
  }

  private isProgressionRequired(events: readonly WorldEvent[]): boolean {
    const hasRootProgressionEvent = events.some((event) => (
      event.type === "world.progression.requested" ||
      event.type === "player.directive" ||
      event.type === "world.event.emitted" ||
      (event.type === "narrative.beat.completed" && event.payload.reason === "resolved")
    ));
    return hasRootProgressionEvent || Boolean(this.plan?.reasons.some((reason) => (
      reason === "player_message_no_focus" || reason === "player_wake_unanswered"
    )));
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
