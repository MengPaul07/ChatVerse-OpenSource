import type {
  ActorPresence,
  ActorStateSource,
  ContextParticipation,
  NarrativeBeat,
  NarrativeChapter,
  NarrativeEdge,
  WorldActorDefinition,
  WorldEvent,
  WorldEventInput,
  WorldEventType,
  WorldExternalEventInput,
  WorldRegisterActorInput,
} from "../../../contracts/world.js";
import type { ChatContextRuntime } from "./context-runtime.js";
import type { PresentationController } from "../presentation/controller.js";
import type {
  WorldDirectorMutation,
  WorldDirectorTaskMode,
} from "../director/index.js";
import type { WorldState } from "../state.js";
import { DEFAULT_BEAT_MAX_ACTOR_TURNS, DEFAULT_BEAT_MIN_ACTOR_TURNS } from "../narrative/beat-metrics.js";
import { unique } from "./helpers.js";

interface ActorParticipationTransition {
  actorId: string;
  contextId: string;
  participation: ContextParticipation;
  source: ActorStateSource;
  reason?: string;
  causationId?: string;
}

interface ActorPresenceTransition {
  actorId: string;
  presence: ActorPresence;
  status?: string;
  statusProvided?: boolean;
  source: ActorStateSource;
  reason?: string;
  contextId?: string;
  causationId?: string;
}

interface DirectorMutationApplierHost {
  state: WorldState;
  presentation: PresentationController;
  getContextRuntime(contextId: string): ChatContextRuntime | undefined;
  applyActorBackgroundUpdate(
    mutation: Extract<WorldDirectorMutation, { type: "update_actor_background" }>,
    causationId: string | undefined,
  ): void;
  emitWorldEvent(
    input: WorldExternalEventInput,
    triggerDirector: boolean,
    causationId?: string,
  ): WorldEvent;
  validateBeatSources(
    chapterId: string,
    sourceEventIds: readonly string[],
    staged: readonly WorldDirectorMutation[],
  ): string | undefined;
  clearNarratorCheckpoint(beatId: string): void;
  commitActorRegistration(input: WorldRegisterActorInput, causationId?: string): WorldEvent;
  transitionActorParticipation(input: ActorParticipationTransition): boolean;
  transitionActorPresence(input: ActorPresenceTransition): boolean;
  scheduleNarrator(
    contextId: string,
    mode: "open_beat",
    sourceEventIds: readonly string[],
  ): void;
  completeBeat(
    beat: NarrativeBeat,
    outcome: string,
    sourceEventIds: readonly string[],
    reason: "resolved" | "superseded",
    preservePresentation?: boolean,
  ): void;
  appendEvent<TType extends WorldEventType>(
    input: WorldEventInput<TType>,
  ): WorldEvent<TType>;
}

/** Applies Director mutations while keeping planning and scheduling outside this module. */
export class DirectorMutationApplier {
  constructor(private readonly host: DirectorMutationApplierHost) {}

  activatePreparedBeat(contextId: string): boolean {
    const beat = [...this.host.state.beats.values()]
      .filter((candidate) => candidate.status === "prepared" && candidate.contextIds.includes(contextId))
      .sort((left, right) => right.occurredAt - left.occurredAt)[0];
    if (!beat) return false;
    this.activateBeat(beat, beat.sourceEventIds.at(-1), true);
    return true;
  }

  apply(
    mutations: readonly WorldDirectorMutation[],
    sourceEvents: readonly WorldEvent[],
    taskMode?: WorldDirectorTaskMode,
  ): Set<string> {
    const causationId = sourceEvents[sourceEvents.length - 1]?.id;
    const progressedContexts = new Set<string>();
    for (const mutation of mutations) {
      switch (mutation.type) {
        case "update_actor_background":
          this.host.applyActorBackgroundUpdate(mutation, causationId);
          break;
        case "emit_world_event":
          this.host.emitWorldEvent({
            message: mutation.message,
            contextIds: mutation.contextIds,
            actorIds: mutation.actorIds,
            correlationId: mutation.correlationId,
          }, false, causationId);
          for (const contextId of mutation.contextIds) {
            const runtime = this.host.getContextRuntime(contextId);
            runtime?.turnCoordinator.clearAmbientWakes();
            runtime?.turnCoordinator.markAmbientOutput();
            progressedContexts.add(contextId);
          }
          break;
        case "plan_beat":
          this.applyPlanBeat(mutation, taskMode, progressedContexts, causationId);
          break;
        case "link_beats": {
          const edge: NarrativeEdge = {
            id: mutation.id,
            fromBeatId: mutation.fromBeatId,
            toBeatId: mutation.toBeatId,
            type: mutation.edgeType,
            description: mutation.description,
            createdAt: this.host.state.worldTime,
          };
          this.host.state.edges.set(edge.id, edge);
          this.host.appendEvent({
            type: "narrative.beats.linked",
            causationId,
            payload: { edge },
          });
          break;
        }
        case "advance_world_time":
          this.host.state.worldTime += mutation.seconds * 1000;
          this.host.appendEvent({
            type: "world.time.advanced",
            causationId,
            payload: {
              seconds: mutation.seconds,
              reason: mutation.reason,
              worldTime: this.host.state.worldTime,
            },
          });
          break;
        case "dismiss_spawned_actor": {
          const actor = this.host.state.actorDefinitions.get(mutation.actorId);
          if (actor?.kind !== "character" || actor.lifecycle !== "scene") break;
          this.host.transitionActorParticipation({
            actorId: mutation.actorId,
            contextId: mutation.contextId,
            participation: "left",
            source: "system",
            reason: mutation.reason,
            causationId,
          });
          this.host.transitionActorPresence({
            actorId: mutation.actorId,
            presence: "offline",
            status: mutation.reason,
            statusProvided: true,
            source: "system",
            reason: mutation.reason,
            causationId,
          });
          break;
        }
        case "set_actor_participation":
          this.host.transitionActorParticipation({
            actorId: mutation.actorId,
            contextId: mutation.contextId,
            participation: mutation.participation,
            source: "director",
            reason: mutation.reason,
            causationId,
          });
          break;
        case "set_actor_presence":
          this.host.transitionActorPresence({
            actorId: mutation.actorId,
            presence: mutation.presence,
            status: mutation.status,
            statusProvided: mutation.status !== undefined,
            source: "director",
            reason: mutation.reason,
            causationId,
          });
          break;
      }
    }
    return progressedContexts;
  }

  private applyPlanBeat(
    mutation: Extract<WorldDirectorMutation, { type: "plan_beat" }>,
    taskMode: WorldDirectorTaskMode | undefined,
    progressedContexts: Set<string>,
    causationId: string | undefined,
  ): void {
    const targetContextIds = unique(mutation.contextIds);
    let chapter = this.host.state.chapters.get(mutation.chapterId);
    if (mutation.newChapter) {
      if (chapter) return;
      const activeChapterConflict = [...this.host.state.chapters.values()].some((candidate) => (
        candidate.status === "active" &&
        candidate.contextIds.some((contextId) => targetContextIds.includes(contextId))
      ));
      if (activeChapterConflict) return;
      chapter = {
        id: mutation.chapterId,
        title: mutation.newChapter.title,
        treatment: mutation.newChapter.treatment,
        targetOutcome: mutation.newChapter.targetOutcome,
        status: "active",
        actorIds: unique(mutation.actorIds),
        contextIds: targetContextIds,
        beatIds: [],
      };
      this.host.state.chapters.set(chapter.id, chapter);
      this.host.appendEvent({
        type: "narrative.chapter.created",
        causationId,
        payload: { chapter },
      });
    }
    if (!chapter || chapter.status !== "active") return;
    if (!mutation.newChapter && !targetContextIds.every((contextId) => chapter!.contextIds.includes(contextId))) return;
    if (!mutation.newChapter && this.host.validateBeatSources(
      mutation.chapterId,
      mutation.sourceEventIds,
      [],
    )) return;

    const superseded = [...this.host.state.beats.values()].filter((beat) => (
      (beat.status === "running" || beat.status === "prepared") &&
      beat.contextIds.some((contextId) => targetContextIds.includes(contextId))
    ));
    const canSupersede = taskMode === "transition_beat" || taskMode === "player_directive";
    if (superseded.length > 0 && !canSupersede) return;
    for (const oldBeat of superseded) {
      for (const contextId of oldBeat.contextIds) this.host.presentation.clearContext(contextId);
      this.host.completeBeat(
        oldBeat,
        "当前一幕已经完成，由新的剧情规划接续。",
        mutation.sourceEventIds,
        "superseded",
      );
    }

    const sceneActors = mutation.script.sceneActors ?? [];
    const deferredOpening = targetContextIds.some((contextId) => {
      const turn = this.host.presentation.current(contextId);
      return turn != null && this.host.state.beats.get(turn.beatId)?.status === "completed";
    });
    const beat: NarrativeBeat = {
      id: mutation.id,
      chapterId: mutation.chapterId,
      title: mutation.title,
      brief: mutation.brief,
      kind: mutation.kind,
      script: {
        ...mutation.script,
        cast: mutation.script.cast.map((member) => ({ ...member })),
        development: [...mutation.script.development],
        causalChain: [...mutation.script.causalChain],
        sceneActors: sceneActors.map((actor) => ({
          ...actor,
          sourceEventIds: [...actor.sourceEventIds],
        })),
        stages: mutation.script.stages?.map((stage) => ({
          ...stage,
          developments: [...stage.developments],
        })),
      },
      completesChapter: mutation.completesChapter,
      minimumActorTurns: Math.max(
        1,
        Math.min(24, Math.round(mutation.minimumActorTurns || DEFAULT_BEAT_MIN_ACTOR_TURNS)),
      ),
      maximumActorTurns: Math.max(
        Math.max(1, Math.min(24, Math.round(mutation.minimumActorTurns || DEFAULT_BEAT_MIN_ACTOR_TURNS))) + 1,
        Math.min(32, Math.round(mutation.maximumActorTurns || DEFAULT_BEAT_MAX_ACTOR_TURNS)),
      ),
      status: deferredOpening ? "prepared" : "running",
      contextIds: targetContextIds,
      actorIds: unique([...mutation.actorIds, ...sceneActors.map((actor) => actor.actorId)]),
      sourceEventIds: [...mutation.sourceEventIds],
      sourceBasis: mutation.sourceBasis ? {
        ...mutation.sourceBasis,
        chunkIds: [...mutation.sourceBasis.chunkIds],
      } : undefined,
      occurredAt: this.host.state.worldTime,
    };
    const chapterAfterBeat: NarrativeChapter = {
      ...chapter,
      actorIds: unique([...chapter.actorIds, ...beat.actorIds]),
      contextIds: unique([...chapter.contextIds, ...beat.contextIds]),
      beatIds: unique([...chapter.beatIds, beat.id]),
    };
    const previousForegroundChapterId = this.host.state.foregroundChapterId;
    this.host.state.foregroundChapterId = chapterAfterBeat.id;
    this.host.state.beats.set(beat.id, beat);
    this.host.clearNarratorCheckpoint(beat.id);
    this.host.state.chapters.set(chapterAfterBeat.id, chapterAfterBeat);
    if (previousForegroundChapterId !== chapterAfterBeat.id) {
      this.host.appendEvent({
        type: "narrative.chapter.focus_changed",
        causationId,
        payload: {
          fromChapterId: previousForegroundChapterId,
          toChapterId: chapterAfterBeat.id,
          reason: previousForegroundChapterId ? "switched" : "initial",
          beatId: beat.id,
        },
      });
    }
    if (!deferredOpening) {
      this.host.appendEvent({
        type: "narrative.beat.recorded",
        causationId,
        payload: { beat, chapter: chapterAfterBeat },
      });
    }

    for (const contextId of beat.contextIds) {
      progressedContexts.add(contextId);
    }
    if (!deferredOpening) this.activateBeat(beat, causationId, false);
  }

  private activateBeat(beat: NarrativeBeat, causationId: string | undefined, publishActivation: boolean): void {
    const priorSceneActorIds = [...this.host.state.actorDefinitions.values()]
      .filter((actor) => actor.lifecycle === "scene")
      .map((actor) => actor.id);
    for (const contextId of beat.contextIds) {
      for (const actorId of priorSceneActorIds) {
        const presence = this.host.state.getPresence(contextId, actorId);
        if (!presence || presence.participation === "left") continue;
        this.host.transitionActorParticipation({
          actorId,
          contextId,
          participation: "left",
          source: "system",
          reason: "上一幕结束，临时角色退场。",
          causationId,
        });
        this.host.transitionActorPresence({
          actorId,
          presence: "offline",
          status: "上一幕结束，临时角色退场。",
          statusProvided: true,
          source: "system",
          reason: "上一幕结束，临时角色退场。",
          contextId,
          causationId,
        });
      }
    }
    for (const sceneActor of beat.script.sceneActors ?? []) {
      if (!beat.contextIds.includes(sceneActor.contextId)) continue;
      const scenario = `${sceneActor.role}。当前目标：${sceneActor.objective}`;
      const actor: WorldActorDefinition = {
        id: sceneActor.actorId,
        kind: "character",
        lifecycle: "scene",
        card: {
          name: sceneActor.name,
          description: sceneActor.role,
          personality: sceneActor.personality,
          scenario,
          messageExample: "",
        },
        background: scenario,
        control: { directorAuthority: "coordinate" },
      };
      this.host.commitActorRegistration({ actor }, causationId);
      this.host.transitionActorParticipation({
        actorId: actor.id,
        contextId: sceneActor.contextId,
        participation: "joined",
        source: "system",
        reason: sceneActor.entrance,
        causationId,
      });
    }
    const running = beat.status === "running" ? beat : { ...beat, status: "running" as const };
    this.host.state.beats.set(running.id, running);
    if (publishActivation) {
      const chapter = this.host.state.chapters.get(running.chapterId);
      if (chapter) {
        this.host.appendEvent({
          type: "narrative.beat.recorded",
          causationId,
          payload: { beat: running, chapter },
        });
      }
    }
    for (const contextId of running.contextIds) {
      if (this.host.getContextRuntime(contextId)?.definition.presentation?.kind === "galgame") {
        this.host.presentation.startBeat(contextId, running.id);
      }
      this.host.scheduleNarrator(contextId, "open_beat", running.sourceEventIds);
    }
  }
}
