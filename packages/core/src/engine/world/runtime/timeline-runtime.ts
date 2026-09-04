import type { WorldEvent } from "../../../contracts/world.js";
import {
  projectIncrementalTimeline,
  type ContextTimelineEntry,
  type TimelineCheckpoint,
} from "../../../context/timeline.js";
import { narratorTimelineEntry } from "./helpers.js";
import { TimelineCurator, type TimelineCuratorCheckpoint } from "../timeline-curator.js";

export interface TimelineRuntimeHost {
  readContextEvents(contextId: string): readonly WorldEvent[];
  readActorJoinedAt(contextId: string, actorId: string): number;
  now(): number;
  lifecycleEpoch(): number;
  isStopped(): boolean;
  onProviderError(contextId: string, error: unknown): void;
}

export interface TimelineRuntimeOptions {
  provider: ConstructorParameters<typeof TimelineCurator>[0];
  minRows: number;
  restored?: ReadonlyArray<{
    contextId: string;
    checkpoint: TimelineCheckpoint;
  }>;
  host: TimelineRuntimeHost;
}

/**
 * Owns the world timeline's replaceable checkpoint and background curator.
 * The World aggregate only supplies event/presence reads and lifecycle hooks.
 */
export class TimelineRuntime {
  private readonly timelineCurator: TimelineCurator;
  private readonly timelineCuratorInFlight = new Set<string>();
  private readonly timelineCuratorControllers = new Map<string, AbortController>();
  private readonly timelineCheckpoints = new Map<string, TimelineCheckpoint>();

  constructor(private readonly options: TimelineRuntimeOptions) {
    this.timelineCurator = new TimelineCurator(options.provider);
    for (const item of options.restored ?? []) {
      this.timelineCheckpoints.set(item.contextId, {
        summary: item.checkpoint.summary,
        facts: [...item.checkpoint.facts],
        throughSequence: item.checkpoint.throughSequence,
        curatedAt: item.checkpoint.curatedAt,
      });
    }
  }

  get checkpoints(): ReadonlyMap<string, TimelineCheckpoint> {
    return this.timelineCheckpoints;
  }

  contextProjection(
    contextId: string,
    triggerEvents: readonly WorldEvent[] = [],
  ): string {
    const rows = this.timelineRowsForContext(contextId);
    this.maybeScheduleCurator(contextId, rows);
    const firstTriggerSequence = triggerEvents.length > 0
      ? Math.min(...triggerEvents.map((event) => event.sequence))
      : Number.POSITIVE_INFINITY;
    const historicalRows = rows.filter((row) => row.order < firstTriggerSequence);
    const checkpoint = this.timelineCheckpoints.get(contextId);
    const historicalCheckpoint = checkpoint && checkpoint.throughSequence < firstTriggerSequence
      ? checkpoint
      : undefined;
    return projectIncrementalTimeline(historicalCheckpoint, historicalRows).block;
  }

  blockForActor(contextId: string, actorId: string): string {
    const rows = this.timelineRowsForContext(contextId, true);
    const joinedAt = this.options.host.readActorJoinedAt(contextId, actorId);
    const projection = joinedAt > 0
      ? projectIncrementalTimeline(undefined, rows.filter((row) => row.order >= joinedAt))
      : projectIncrementalTimeline(this.timelineCheckpoints.get(contextId), rows);
    return projection.block;
  }

  stop(): void {
    for (const controller of this.timelineCuratorControllers.values()) controller.abort();
    this.timelineCuratorControllers.clear();
    this.timelineCuratorInFlight.clear();
  }

  private timelineRowsForContext(
    contextId: string,
    hideRuntimeEvents = false,
  ): ContextTimelineEntry[] {
    const hiddenRuntimeEvents = new Set([
      "context.activated",
      "context.suspended",
      "context.status_changed",
      "world.progression.requested",
      "world.status_changed",
    ]);
    return this.options.host
      .readContextEvents(contextId)
      .filter((event) => (
        event.type !== "actor.memory.updated" &&
        (!hideRuntimeEvents || !hiddenRuntimeEvents.has(event.type))
      ))
      .sort((left, right) => left.sequence - right.sequence)
      .map(narratorTimelineEntry);
  }

  private maybeScheduleCurator(
    contextId: string,
    rows: readonly ContextTimelineEntry[],
  ): void {
    if (this.options.minRows <= 0 || this.timelineCuratorInFlight.has(contextId)) return;
    const checkpoint = this.timelineCheckpoints.get(contextId);
    const pending = checkpoint
      ? rows.filter((row) => row.order > checkpoint.throughSequence)
      : rows;
    if (pending.length < this.options.minRows) return;

    const controller = new AbortController();
    const lifecycleEpoch = this.options.host.lifecycleEpoch();
    const throughSequence = pending[pending.length - 1]!.order;
    const previousCheckpoint: TimelineCuratorCheckpoint | undefined = checkpoint
      ? {
          summary: checkpoint.summary,
          facts: checkpoint.facts,
        }
      : undefined;
    this.timelineCuratorInFlight.add(contextId);
    this.timelineCuratorControllers.set(contextId, controller);

    void this.timelineCurator
      .curate(
        pending.map((row) => row.text),
        previousCheckpoint,
        controller.signal,
      )
      .then((result) => {
        if (
          controller.signal.aborted ||
          this.options.host.isStopped() ||
          lifecycleEpoch !== this.options.host.lifecycleEpoch() ||
          this.timelineCuratorControllers.get(contextId) !== controller
        ) return;
        this.timelineCheckpoints.set(contextId, {
          summary: result.summary,
          facts: result.facts,
          throughSequence,
          curatedAt: this.options.host.now(),
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) this.options.host.onProviderError(contextId, error);
      })
      .finally(() => {
        if (this.timelineCuratorControllers.get(contextId) === controller) {
          this.timelineCuratorControllers.delete(contextId);
          this.timelineCuratorInFlight.delete(contextId);
        }
      });
  }
}
