import type {
  ContextPresenceState,
  NarrativeBeat,
  NarrativeEdge,
  NarrativeNarration,
  NarrativeChapter,
  ResolvedWorldActorControlPolicy,
  WorldActorControlPolicy,
  WorldActorControlState,
  WorldActorDefinition,
  WorldActorBackgroundState,
  WorldActorState,
  WorldContextDefinition,
  WorldContextState,
  WorldDefinition,
  WorldRelation,
  WorldSnapshot,
} from "../../contracts/world.js";
import type {
  ActorMemoryRuntimeSnapshot,
  ActorMemorySnapshot,
} from "../../contracts/actor-memory.js";
import type { RuntimeHost } from "../../runtime/types.js";
import { WorldEventJournal } from "./event-journal.js";

export class WorldState {
  readonly definition: WorldDefinition;
  readonly journal: WorldEventJournal;
  readonly actorDefinitions = new Map<string, WorldActorDefinition>();
  readonly relations: WorldRelation[];
  readonly actorStates = new Map<string, WorldActorState>();
  readonly actorBackgrounds = new Map<string, WorldActorBackgroundState>();
  readonly actorControls = new Map<string, WorldActorControlState>();
  readonly presences = new Map<string, ContextPresenceState>();
  readonly contexts = new Map<string, WorldContextState>();
  readonly beats = new Map<string, NarrativeBeat>();
  readonly edges = new Map<string, NarrativeEdge>();
  readonly chapters = new Map<string, NarrativeChapter>();
  foregroundChapterId: string | undefined;
  private readonly initialActorIds: Set<string>;
  private readonly initialContextIds: Set<string>;
  private readonly initialRelationsByPair: Map<string, WorldRelation>;
  worldTime: number;
  directorCursor: number;

  constructor(
    definition: WorldDefinition,
    runtime: RuntimeHost,
    snapshot?: WorldSnapshot,
  ) {
    this.definition = definition;
    const now = runtime.clock.now();
    this.initialActorIds = new Set(definition.actors.map((actor) => actor.id));
    this.initialContextIds = new Set(definition.contexts.map((context) => context.id));
    this.initialRelationsByPair = new Map(
      (definition.relations ?? []).map((relation) => [relationPairKey(relation), { ...relation }]),
    );
    for (const actor of definition.actors) {
      this.actorDefinitions.set(actor.id, cloneActorDefinition(actor));
    }
    for (const actor of snapshot?.dynamicActors ?? []) {
      if (!this.actorDefinitions.has(actor.id)) {
        this.actorDefinitions.set(actor.id, cloneActorDefinition(actor));
      }
    }
    const restoredRelations = new Map(this.initialRelationsByPair);
    for (const relation of snapshot?.dynamicRelations ?? []) {
      restoredRelations.set(relationPairKey(relation), { ...relation });
    }
    this.relations = [...restoredRelations.values()].map((relation) => ({ ...relation }));
    // Dynamic Context definitions are part of the durable world shape, while
    // the existing `contexts` array only stores their mutable projections.
    // Restore them before building Context state/runtimes so a cold restart
    // can recreate the corresponding Session instead of dropping the dialog.
    for (const context of snapshot?.dynamicContexts ?? []) {
      if (!this.definition.contexts.some((candidate) => candidate.id === context.id)) {
        this.definition.contexts.push(structuredClone(context));
      }
    }
    this.worldTime = snapshot?.worldTime ?? now;
    this.directorCursor = snapshot?.directorCursor ?? 0;
    this.journal = new WorldEventJournal(
      definition.metadata.id,
      runtime,
      snapshot?.events,
      snapshot?.eventSequence,
    );

    for (const actor of this.actorDefinitions.values()) {
      const restored = snapshot?.actorStates.find((state) => state.actorId === actor.id);
      this.actorStates.set(actor.id, restored
        ? normalizeRestoredActorState(restored)
        : {
        actorId: actor.id,
        presence: actor.initialState?.presence ?? "online",
        status: actor.initialState?.status,
        revision: 0,
        updatedAt: now,
      });
      const restoredBackground = snapshot?.actorBackgrounds.find(
        (background) => background.actorId === actor.id,
      );
      this.actorBackgrounds.set(
        actor.id,
        restoredBackground
          ? cloneActorBackground(restoredBackground)
          : createInitialActorBackground(actor, now),
      );
      const restoredControl = snapshot?.actorControls.find(
        (control) => control.actorId === actor.id,
      );
      this.actorControls.set(actor.id, restoredControl
        ? cloneActorControl(restoredControl)
        : {
            actorId: actor.id,
            policy: resolveActorControlPolicy(actor.control, actor.kind, isPlayerControlledActor(actor)),
            updatedAt: now,
          });
    }

    for (const context of this.definition.contexts) {
      const restored = snapshot?.contexts.find((state) => state.contextId === context.id);
      const restoredScene = cloneNarrationScene(restored?.scene);
      const journalScene = findLatestNarrationScene(this.journal.all(), context.id);
      const scene = restoredScene ?? journalScene ?? createInitialNarration(context, this.worldTime, runtime);
      if (!restoredScene && !journalScene) {
        this.journal.append({
          type: "narrative.narration.committed",
          contextId: context.id,
          payload: { narration: scene },
        });
      }
      this.contexts.set(context.id, {
        contextId: context.id,
        status: restored?.status ?? "dormant",
        scene,
        activity: restored?.activity
          ? {
              ...restored.activity,
              focusActorIds: [...restored.activity.focusActorIds],
            }
          : restoreContextActivity(this.journal.all(), context.id, now),
        updatedAt: restored?.updatedAt ?? now,
      });
      for (const actorId of context.actorIds) {
        const key = presenceKey(context.id, actorId);
        const restoredPresence = snapshot?.presences.find(
          (presence) => presence.contextId === context.id && presence.actorId === actorId,
        );
        this.presences.set(key, restoredPresence
          ? normalizeRestoredPresence(restoredPresence)
          : {
          actorId,
          contextId: context.id,
          participation: "joined",
          joinedAtSequence: 0,
          lastSeenSequence: 0,
          updatedAt: now,
        });
      }
    }
    for (const restoredPresence of snapshot?.presences ?? []) {
      if (
        !this.actorDefinitions.has(restoredPresence.actorId) ||
        !this.contexts.has(restoredPresence.contextId)
      ) continue;
      this.presences.set(
        presenceKey(restoredPresence.contextId, restoredPresence.actorId),
        normalizeRestoredPresence(restoredPresence),
      );
    }

    for (const chapter of snapshot?.narrative.chapters ?? definition.chapters ?? []) {
      this.chapters.set(chapter.id, cloneChapter(chapter));
    }
    for (const beat of snapshot?.narrative.beats ?? []) {
      if (!this.chapters.has(beat.chapterId)) {
        throw new Error(`Snapshot beat ${beat.id} references unknown chapter ${beat.chapterId}.`);
      }
      this.beats.set(beat.id, cloneBeat(beat));
    }
    for (const edge of snapshot?.narrative.edges ?? []) {
      this.edges.set(edge.id, { ...edge });
    }
    const restoredForegroundChapterId = snapshot?.narrative.foregroundChapterId;
    const restoredForegroundChapter = restoredForegroundChapterId
      ? this.chapters.get(restoredForegroundChapterId)
      : undefined;
    if (restoredForegroundChapter?.status === "active") {
      this.foregroundChapterId = restoredForegroundChapter.id;
    } else {
      this.foregroundChapterId = [...this.beats.values()]
        .filter((beat) => beat.status === "running")
        .sort((left, right) => right.occurredAt - left.occurredAt)[0]?.chapterId;
    }
  }

  getActorState(actorId: string): WorldActorState | undefined {
    const state = this.actorStates.get(actorId);
    return state ? { ...state } : undefined;
  }

  getActorDefinition(actorId: string): WorldActorDefinition | undefined {
    const actor = this.actorDefinitions.get(actorId);
    return actor ? cloneActorDefinition(actor) : undefined;
  }

  /**
   * Replace the runtime copy of an Actor definition.
   *
   * Public World APIs intentionally return cloned definitions, so mutating a
   * value returned by getActorDefinition() must never be relied on to update
   * the runtime registry. Player-card edits and similar definition changes use
   * this method to make the new definition visible to every prompt builder.
   */
  updateActorDefinition(actor: WorldActorDefinition): void {
    if (!this.actorDefinitions.has(actor.id)) {
      throw new Error(`Unknown world actor id: ${actor.id}`);
    }
    this.actorDefinitions.set(actor.id, cloneActorDefinition(actor));
  }

  actorIdsInContext(contextId: string, includeLeft = false): string[] {
    return [...this.presences.values()]
      .filter((presence) => (
        presence.contextId === contextId &&
        (includeLeft || presence.participation !== "left")
      ))
      .map((presence) => presence.actorId);
  }

  registerActor(actor: WorldActorDefinition, now: number): void {
    if (this.actorDefinitions.has(actor.id)) {
      throw new Error(`Duplicate world actor id: ${actor.id}`);
    }
    const stored = cloneActorDefinition(actor);
    this.actorDefinitions.set(stored.id, stored);
    this.actorStates.set(stored.id, {
      actorId: stored.id,
      presence: stored.initialState?.presence ?? "online",
      status: stored.initialState?.status,
      revision: 0,
      updatedAt: now,
    });
    this.actorBackgrounds.set(
      stored.id,
      createInitialActorBackground(stored, now),
    );
    this.actorControls.set(stored.id, {
      actorId: stored.id,
      policy: resolveActorControlPolicy(stored.control, stored.kind, isPlayerControlledActor(stored)),
      updatedAt: now,
    });
  }

  addRelations(relations: readonly WorldRelation[]): void {
    for (const relation of relations) {
      this.upsertRelation(relation);
    }
  }

  upsertRelation(relation: WorldRelation): { changed: boolean; previous?: WorldRelation } {
    const key = relationPairKey(relation);
    const index = this.relations.findIndex((candidate) => relationPairKey(candidate) === key);
    const previous = index >= 0 ? { ...this.relations[index]! } : undefined;
    if (previous?.description === relation.description) return { changed: false, previous };
    if (index >= 0) this.relations[index] = { ...relation };
    else this.relations.push({ ...relation });
    return { changed: true, previous };
  }

  resetRelation(fromActorId: string, toActorId: string): {
    changed: boolean;
    previous?: WorldRelation;
    current?: WorldRelation;
  } {
    const key = relationPairKey({ fromActorId, toActorId });
    const index = this.relations.findIndex((candidate) => relationPairKey(candidate) === key);
    const previous = index >= 0 ? { ...this.relations[index]! } : undefined;
    const baseline = this.initialRelationsByPair.get(key);
    if (baseline) {
      if (previous?.description === baseline.description) {
        return { changed: false, previous, current: { ...baseline } };
      }
      if (index >= 0) this.relations[index] = { ...baseline };
      else this.relations.push({ ...baseline });
      return { changed: true, previous, current: { ...baseline } };
    }
    if (index < 0) return { changed: false };
    this.relations.splice(index, 1);
    return { changed: true, previous };
  }

  /** Add a runtime Context while keeping the World definition/snapshot projections aligned. */
  addContext(context: WorldContextDefinition, runtime: RuntimeHost): WorldContextState {
    if (this.contexts.has(context.id)) {
      throw new Error(`Duplicate world context id: ${context.id}`);
    }
    for (const actorId of context.actorIds) {
      if (!this.actorDefinitions.has(actorId)) {
        throw new Error(`Context ${context.id} references an unknown Actor: ${actorId}`);
      }
    }

    const now = runtime.clock.now();
    const scene = createInitialNarration(context, this.worldTime, runtime);
    const state: WorldContextState = {
      contextId: context.id,
      status: "dormant",
      scene,
      activity: {
        revision: 0,
        focusActorIds: [],
        lastCommittedAt: now,
        ambientNoopCount: 0,
      },
      updatedAt: now,
    };

    this.definition.contexts.push(context);
    this.contexts.set(context.id, state);
    for (const actorId of context.actorIds) {
      this.presences.set(presenceKey(context.id, actorId), {
        actorId,
        contextId: context.id,
        participation: "joined",
        joinedAtSequence: this.journal.lastSequence,
        lastSeenSequence: this.journal.lastSequence,
        updatedAt: now,
      });
    }
    return cloneContextState(state);
  }

  ensurePresence(
    contextId: string,
    actorId: string,
    now: number,
    joinedAtSequence: number,
  ): ContextPresenceState {
    const key = presenceKey(contextId, actorId);
    const existing = this.presences.get(key);
    if (existing) return { ...existing };
    const created: ContextPresenceState = {
      actorId,
      contextId,
      participation: "left",
      joinedAtSequence,
      lastSeenSequence: joinedAtSequence,
      updatedAt: now,
    };
    this.presences.set(key, created);
    return { ...created };
  }

  getPresence(contextId: string, actorId: string): ContextPresenceState | undefined {
    const state = this.presences.get(presenceKey(contextId, actorId));
    return state ? { ...state } : undefined;
  }

  snapshot(
    contextSessions: WorldSnapshot["contextSessions"],
    now: number,
    actorMemories: ActorMemorySnapshot[],
    actorMemoryRuntime: ActorMemoryRuntimeSnapshot[],
    presentationRuntime: WorldSnapshot["presentationRuntime"] = [],
  ): WorldSnapshot {
    return {
      schemaVersion: 7,
      worldId: this.definition.metadata.id,
      worldTime: this.worldTime,
      eventSequence: this.journal.lastSequence,
      events: this.journal.all(),
      actorStates: [...this.actorStates.values()].map((state) => ({ ...state })),
      actorBackgrounds: [...this.actorBackgrounds.values()].map(cloneActorBackground),
      actorControls: [...this.actorControls.values()].map(cloneActorControl),
      dynamicActors: [...this.actorDefinitions.values()]
        .filter((actor) => !this.initialActorIds.has(actor.id))
        .map(cloneActorDefinition),
      dynamicContexts: this.definition.contexts
        .filter((context) => !this.initialContextIds.has(context.id))
        .map((context) => structuredClone(context)),
      dynamicRelations: this.relations
        .filter((relation) => {
          const initial = this.initialRelationsByPair.get(relationPairKey(relation));
          return !initial || initial.description !== relation.description;
        })
        .map((relation) => ({ ...relation })),
      actorMemories,
      actorMemoryRuntime,
      presences: [...this.presences.values()].map((presence) => ({ ...presence })),
      contexts: [...this.contexts.values()].map(cloneContextState),
      contextSessions,
      presentationRuntime: presentationRuntime.map((entry) => structuredClone(entry)),
      narrative: {
        beats: [...this.beats.values()].map(cloneBeat),
        edges: [...this.edges.values()].map((edge) => ({ ...edge })),
        chapters: [...this.chapters.values()].map(cloneChapter),
        foregroundChapterId: this.foregroundChapterId,
      },
      directorCursor: this.directorCursor,
      timestamp: now,
    };
  }
}

export function resolveActorControlPolicy(
  input: WorldActorControlPolicy | undefined,
  actorKind: "character" | "human",
  playerControlled = actorKind === "human",
): ResolvedWorldActorControlPolicy {
  return {
    directorAuthority: input?.directorAuthority ?? (
      playerControlled ? "observe" : "coordinate"
    ),
  };
}

function normalizeRestoredActorState(state: WorldActorState): WorldActorState {
  return { ...state };
}

function createInitialActorBackground(
  actor: Extract<WorldActorDefinition, { kind: "character" }>,
  now: number,
): WorldActorBackgroundState {
  return {
    actorId: actor.id,
    text: actor.background?.trim() || actor.card.scenario.trim(),
    revision: 0,
    sourceEventIds: [],
    updatedAtSequence: 0,
    updatedAt: now,
  };
}

function cloneActorBackground(
  background: WorldActorBackgroundState,
): WorldActorBackgroundState {
  return {
    ...background,
    sourceEventIds: [...background.sourceEventIds],
  };
}

function normalizeRestoredPresence(state: ContextPresenceState): ContextPresenceState {
  return {
    ...state,
    joinedAtSequence: state.joinedAtSequence ?? 0,
  };
}

function cloneActorControl(state: WorldActorControlState): WorldActorControlState {
  return {
    ...state,
    policy: { ...state.policy },
  };
}

export function presenceKey(contextId: string, actorId: string): string {
  return `${contextId}\u0000${actorId}`;
}

function relationPairKey(relation: Pick<WorldRelation, "fromActorId" | "toActorId">): string {
  return `${relation.fromActorId}\u0000${relation.toActorId}`;
}

function cloneActorDefinition(actor: WorldActorDefinition): WorldActorDefinition {
  return {
        ...actor,
        card: {
          ...actor.card,
          visual: actor.card.visual ? { ...actor.card.visual } : undefined,
          loreBook: actor.card.loreBook ? {
            ...actor.card.loreBook,
            entries: actor.card.loreBook.entries.map((entry) => ({
              ...entry,
              keys: [...entry.keys],
            })),
          } : undefined,
        },
        playerCard: actor.playerCard ? {
          ...actor.playerCard,
          visual: actor.playerCard.visual ? { ...actor.playerCard.visual } : undefined,
        } : undefined,
        memory: actor.memory ? {
          ...actor.memory,
          documents: actor.memory.documents?.map((document) => ({ ...document })),
          nodes: actor.memory.nodes?.map((node) => ({
            ...node,
            tags: node.tags ? [...node.tags] : undefined,
            sourceEventIds: node.sourceEventIds ? [...node.sourceEventIds] : undefined,
          })),
          edges: actor.memory.edges?.map((edge) => ({ ...edge })),
        } : undefined,
        initialState: actor.initialState ? { ...actor.initialState } : undefined,
        control: actor.control ? { ...actor.control } : undefined,
      };
}

function isPlayerControlledActor(actor: WorldActorDefinition): boolean {
  return actor.playerControlled === true;
}

function cloneContextState(state: WorldContextState): WorldContextState {
  return {
    ...state,
    scene: cloneNarrationScene(state.scene)!,
    activity: state.activity
      ? {
          ...state.activity,
          focusActorIds: [...state.activity.focusActorIds],
        }
      : undefined,
  };
}

function restoreContextActivity(
  events: readonly import("../../contracts/world.js").WorldEvent[],
  contextId: string,
  now: number,
): NonNullable<WorldContextState["activity"]> {
  const relevant = events.filter((event) => (
    event.contextId === contextId &&
    (
      event.type === "context.message.committed" ||
      event.type === "context.action.committed" ||
      event.type === "narrative.narration.committed"
    )
  ));
  const focusActorIds: string[] = [];
  for (let index = relevant.length - 1; index >= 0 && focusActorIds.length < 2; index--) {
    const actorId = relevant[index]?.actorId;
    if (actorId && !focusActorIds.includes(actorId)) focusActorIds.push(actorId);
  }
  return {
    revision: relevant.length,
    focusActorIds,
    lastCommittedAt: relevant[relevant.length - 1]?.occurredAt ?? now,
    ambientNoopCount: 0,
  };
}

function cloneNarrationScene(value: unknown): NarrativeNarration | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("World narration scene must be an object.");
  }
  const scene = value as Partial<NonNullable<WorldContextState["scene"]>>;
  if (
    typeof scene.id !== "string" ||
    typeof scene.contextId !== "string" ||
    typeof scene.text !== "string" ||
    !Array.isArray(scene.sourceEventIds) ||
    scene.sourceEventIds.some((id) => typeof id !== "string") ||
    typeof scene.occurredAt !== "number" ||
    !Number.isFinite(scene.occurredAt)
  ) {
    throw new Error("World narration scene does not match the current schema.");
  }
  return {
    id: scene.id,
    contextId: scene.contextId,
    text: scene.text,
    sourceEventIds: [...scene.sourceEventIds],
    occurredAt: scene.occurredAt,
  };
}

function findLatestNarrationScene(
  events: readonly import("../../contracts/world.js").WorldEvent[],
  contextId: string,
): NarrativeNarration | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.type !== "narrative.narration.committed" || event.contextId !== contextId) continue;
    const narration = cloneNarrationScene(event.payload.narration);
    if (narration) return narration;
  }
  return undefined;
}

function createInitialNarration(
  context: WorldDefinition["contexts"][number],
  occurredAt: number,
  runtime: RuntimeHost,
): NarrativeNarration {
  const atmosphere = context.scene.atmosphere.trim();
  const topic = context.scene.topic.trim();
  const text = uniqueText([atmosphere, topic]).join("\n") || context.name;
  return {
    id: runtime.idGenerator.next(),
    contextId: context.id,
    text,
    sourceEventIds: [],
    occurredAt,
  };
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function cloneBeat(beat: NarrativeBeat): NarrativeBeat {
  return {
    ...beat,
    actorIds: [...beat.actorIds],
    contextIds: [...beat.contextIds],
    sourceEventIds: [...beat.sourceEventIds],
    script: {
      ...beat.script,
      cast: beat.script.cast.map((member) => ({ ...member })),
      development: [...beat.script.development],
      causalChain: [...beat.script.causalChain],
      sceneActors: beat.script.sceneActors?.map((actor) => ({
        ...actor,
        sourceEventIds: [...actor.sourceEventIds],
      })),
      stages: beat.script.stages?.map((stage) => ({
        ...stage,
        developments: [...stage.developments],
      })),
    },
    sourceBasis: beat.sourceBasis ? {
      ...beat.sourceBasis,
      chunkIds: [...beat.sourceBasis.chunkIds],
    } : undefined,
  };
}

function cloneChapter(chapter: NarrativeChapter): NarrativeChapter {
  return {
    ...chapter,
    actorIds: [...chapter.actorIds],
    contextIds: [...chapter.contextIds],
    beatIds: [...chapter.beatIds],
  };
}
