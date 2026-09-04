import type {
  NarrativeBeat,
  NarrativeChapter,
  WorldEvent,
  WorldEventInput,
  WorldEventType,
} from "../../../contracts/world.js";
import type { ActorMemoryUpdateCoordinator } from "../../actor-memory/coordinator.js";
import type { NarratorRuntime } from "../runtime/narrator-runtime.js";
import type { PresentationController } from "../presentation/controller.js";
import type { WorldState } from "../state.js";
import { truncateText, unique } from "../runtime/helpers.js";

interface BeatCompletionHost {
  state: WorldState;
  narratorRuntime: Pick<NarratorRuntime, "clearCheckpoint">;
  actorMemoryUpdates: Pick<ActorMemoryUpdateCoordinator, "consolidate">;
  presentation: Pick<PresentationController, "clearContext">;
  appendEvent<TType extends WorldEventType>(input: WorldEventInput<TType>): WorldEvent<TType>;
}

/** Commits a Beat and owns the Chapter transition caused by its completion. */
export class BeatCompletionRuntime {
  constructor(private readonly host: BeatCompletionHost) {}

  complete(
    beat: NarrativeBeat,
    outcome: string,
    sourceEventIds: readonly string[],
    reason: "resolved" | "superseded",
    preservePresentation = false,
  ): void {
    const current = this.host.state.beats.get(beat.id);
    const chapter = this.host.state.chapters.get(beat.chapterId);
    if (!current || current.status === "completed" || !chapter) return;

    const completed: NarrativeBeat = {
      ...current,
      status: "completed",
      outcome: truncateText(outcome, 600),
      completedAt: this.host.state.worldTime,
      sourceEventIds: unique([...current.sourceEventIds, ...sourceEventIds]),
    };
    this.host.state.beats.set(completed.id, completed);
    this.host.narratorRuntime.clearCheckpoint(completed.id);

    const closesChapter = reason === "resolved" && completed.completesChapter;
    const chapterAfterBeat: NarrativeChapter = {
      ...chapter,
      beatIds: unique([...chapter.beatIds, completed.id]),
      ...(closesChapter ? {
        status: "completed" as const,
        outcome: completed.outcome ?? outcome,
      } : {}),
    };
    this.host.state.chapters.set(chapterAfterBeat.id, chapterAfterBeat);
    const completedContextId = completed.contextIds[0];
    this.host.appendEvent({
      type: "narrative.beat.completed",
      contextId: completedContextId,
      causationId: sourceEventIds.at(-1),
      payload: { beat: completed, chapter: chapterAfterBeat, reason },
    });

    if (closesChapter) {
      this.host.appendEvent({
        type: "narrative.chapter.completed",
        contextId: completedContextId,
        causationId: sourceEventIds.at(-1),
        payload: { chapter: chapterAfterBeat },
      });
      this.activateNextChapter(chapterAfterBeat, completed.contextIds, sourceEventIds);
    }

    this.host.actorMemoryUpdates.consolidate(
      completed.actorIds,
      `beat_completed:${completed.id}`,
    );
    if (!preservePresentation) {
      for (const contextId of completed.contextIds) {
        this.host.presentation.clearContext(contextId);
      }
    }
  }

  private activateNextChapter(
    completed: NarrativeChapter,
    contextIds: readonly string[],
    sourceEventIds: readonly string[],
  ): void {
    const next = [...this.host.state.chapters.values()].find((candidate) => (
      candidate.status === "queued" &&
      contextIds.length > 0 &&
      candidate.contextIds.some((contextId) => contextIds.includes(contextId))
    ));
    const contextId = contextIds[0];
    const fromChapterId = this.host.state.foregroundChapterId;
    if (!next) {
      if (fromChapterId === completed.id) this.host.state.foregroundChapterId = undefined;
      if (fromChapterId === completed.id) {
        this.host.appendEvent({
          type: "narrative.chapter.focus_changed",
          contextId,
          causationId: sourceEventIds.at(-1),
          payload: {
            fromChapterId: completed.id,
            reason: "completed",
          },
        });
      }
      return;
    }

    const activated: NarrativeChapter = { ...next, status: "active" };
    this.host.state.chapters.set(activated.id, activated);
    this.host.state.foregroundChapterId = activated.id;
    this.host.appendEvent({
      type: "narrative.chapter.activated",
      contextId,
      causationId: sourceEventIds.at(-1),
      payload: { chapter: activated },
    });
    this.host.appendEvent({
      type: "narrative.chapter.focus_changed",
      contextId,
      causationId: sourceEventIds.at(-1),
      payload: {
        fromChapterId: fromChapterId ?? completed.id,
        toChapterId: activated.id,
        reason: "completed",
      },
    });
  }
}
