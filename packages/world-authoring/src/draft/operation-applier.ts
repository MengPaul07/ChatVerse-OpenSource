import type {
  DraftActor,
  DraftContext,
  DraftChapter,
  DraftRelation,
  WorldDraft,
  WorldDraftOperation,
} from "../types.js";
import type { DraftIdGenerator } from "./contracts.js";

export function applyWorldDraftOperations(
  input: WorldDraft,
  operations: readonly WorldDraftOperation[],
  options: {
    expectedRevision?: number;
    idGenerator?: DraftIdGenerator;
    lastChangeSummary?: string;
    captureOperations?: (operations: WorldDraftOperation[]) => void;
  } = {},
): WorldDraft {
  if (operations.length > 12) {
    throw new WorldDraftOperationError("一次最多应用 12 个修改。");
  }
  if (
    options.expectedRevision !== undefined &&
    input.revision !== options.expectedRevision
  ) {
    throw new WorldDraftRevisionError(options.expectedRevision, input.revision);
  }

  const next = structuredClone(input);
  const idGenerator = options.idGenerator ?? defaultIdGenerator(next);
  const normalizedOperations = normalizeNewIds(next, operations, idGenerator);
  for (const operation of normalizedOperations) applyOperation(next, operation, idGenerator);
  options.captureOperations?.(structuredClone(normalizedOperations));
  next.revision = input.revision + 1;
  if (options.lastChangeSummary?.trim()) {
    next.lastChangeSummary = options.lastChangeSummary.trim();
  }
  return next;
}

export class WorldDraftRevisionError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`草稿版本冲突：期望 ${expectedRevision}，当前为 ${actualRevision}。`);
    this.name = "WorldDraftRevisionError";
  }
}

export class WorldDraftOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldDraftOperationError";
  }
}

function applyOperation(
  draft: WorldDraft,
  operation: WorldDraftOperation,
  idGenerator: DraftIdGenerator,
): void {
  switch (operation.type) {
    case "set_metadata":
      {
      const previousName = draft.metadata.name;
      draft.metadata = {
        ...draft.metadata,
        ...cleanDefined(operation.metadata),
        name: cleanText(operation.metadata.name) || draft.metadata.name,
        description: operation.metadata.description == null
          ? draft.metadata.description
          : cleanText(operation.metadata.description),
        tags: !Array.isArray(operation.metadata.tags)
          ? draft.metadata.tags
          : uniqueStrings(operation.metadata.tags),
      };
      syncContextGroupNames(draft, previousName);
      return;
      }
    case "set_premise":
      draft.premise = operation.premise.trim();
      return;
    case "set_lore":
      draft.lore = {
        core: operation.lore.core == null
          ? draft.lore.core
          : cleanText(operation.lore.core),
        rules: !Array.isArray(operation.lore.rules)
          ? draft.lore.rules
          : uniqueStrings(operation.lore.rules),
      };
      return;
    case "upsert_player": {
      const id = operation.player.id?.trim() || draft.player?.id || idGenerator("player");
      if (
        operation.player.profile !== undefined
        && (
          typeof operation.player.profile !== "object"
          || operation.player.profile === null
          || Array.isArray(operation.player.profile)
        )
      ) {
        throw new WorldDraftOperationError("player.profile 必须是对象。请把玩家卡放在 playerCard 字段中。");
      }
      draft.player = {
        id,
        mode: operation.player.mode ?? draft.player?.mode ?? "participant",
        profile: {
          ...(draft.player?.profile ?? { name: "你", card: "世界参与者" }),
          ...(operation.player.profile ?? {}),
        },
        playerCard: operation.player.playerCard === undefined
          ? draft.player?.playerCard
          : structuredClone(operation.player.playerCard),
      };
      return;
    }
    case "remove_player": {
      if (!draft.player) return;
      assertActorUnreferenced(draft, draft.player.id);
      draft.player = undefined;
      return;
    }
    case "upsert_actor": {
      assertCharacterCard(operation.actor.card);
      const requestedId = operation.actor.id?.trim();
      const index = requestedId
        ? draft.actors.findIndex((actor) => actor.id === requestedId)
        : -1;
      const previous = index >= 0 ? draft.actors[index] : undefined;
      const actor: DraftActor = {
        id: requestedId || idGenerator("actor"),
        role: operation.actor.role ?? previous?.role ?? "support",
        card: structuredClone(operation.actor.card),
        background: operation.actor.background == null
          ? previous?.background
          : operationString(operation.actor.background, "actor.background"),
      };
      if (index >= 0) draft.actors[index] = actor;
      else draft.actors.push(actor);
      return;
    }
    case "remove_actor": {
      const index = draft.actors.findIndex((actor) => actor.id === operation.actorId);
      if (index < 0) throw new WorldDraftOperationError(`找不到 Actor：${operation.actorId}`);
      assertActorUnreferenced(draft, operation.actorId);
      draft.actors.splice(index, 1);
      return;
    }
    case "upsert_relation": {
      const requestedId = operation.relation.id?.trim();
      const index = requestedId
        ? draft.relations.findIndex((relation) => relation.id === requestedId)
        : -1;
      const relation: DraftRelation = {
        id: requestedId || idGenerator("relation"),
        fromActorId: requiredOperationString(
          operation.relation.fromActorId,
          "relation.fromActorId",
        ),
        toActorId: requiredOperationString(
          operation.relation.toActorId,
          "relation.toActorId",
        ),
        description: requiredOperationString(
          operation.relation.description,
          "relation.description",
        ),
      };
      assertKnownActor(draft, relation.fromActorId);
      assertKnownActor(draft, relation.toActorId);
      if (index >= 0) draft.relations[index] = relation;
      else draft.relations.push(relation);
      return;
    }
    case "remove_relation": {
      const index = draft.relations.findIndex((relation) => relation.id === operation.relationId);
      if (index < 0) throw new WorldDraftOperationError(`找不到关系：${operation.relationId}`);
      draft.relations.splice(index, 1);
      return;
    }
    case "upsert_context": {
      assertSceneCard(operation.context.scene);
      const requestedId = operation.context.id?.trim();
      const index = requestedId
        ? draft.contexts.findIndex((context) => context.id === requestedId)
        : -1;
      if (index < 0 && draft.contexts.length >= 1) {
        throw new WorldDraftOperationError("第一版 World Studio 只支持一个 Context。");
      }
      const previous = index >= 0 ? draft.contexts[index] : undefined;
      const context: DraftContext = {
        id: requestedId || idGenerator("context"),
        name: requiredOperationString(operation.context.name, "context.name"),
        actorIds: Array.isArray(operation.context.actorIds)
          ? uniqueStrings(operation.context.actorIds)
          : previous?.actorIds ?? [],
        scene: structuredClone(operation.context.scene),
        opening: operationString(operation.context.opening, "context.opening"),
        lore: operation.context.lore === undefined
          ? previous?.lore
          : structuredClone(operation.context.lore),
        presentation: operation.context.presentation === undefined
          ? previous?.presentation
          : structuredClone(operation.context.presentation),
      };
      for (const actorId of context.actorIds) assertKnownActor(draft, actorId);
      if (index >= 0) draft.contexts[index] = context;
      else draft.contexts.push(context);
      return;
    }
    case "upsert_chapter": {
      const requestedId = operation.chapter.id?.trim();
      const index = requestedId
        ? draft.chapters.findIndex((chapter) => chapter.id === requestedId)
        : -1;
      const previous = index >= 0 ? draft.chapters[index] : undefined;
      const chapter: DraftChapter = {
        id: requestedId || idGenerator("chapter"),
        title: requiredOperationString(operation.chapter.title, "chapter.title"),
        treatment: requiredOperationString(operation.chapter.treatment, "chapter.treatment"),
        targetOutcome: requiredOperationString(operation.chapter.targetOutcome, "chapter.targetOutcome"),
        status: operation.chapter.status ?? previous?.status ?? (draft.chapters.length === 0 ? "active" : "queued"),
        actorIds: Array.isArray(operation.chapter.actorIds)
          ? uniqueStrings(operation.chapter.actorIds)
          : previous?.actorIds ?? [],
        contextIds: Array.isArray(operation.chapter.contextIds)
          ? uniqueStrings(operation.chapter.contextIds)
          : previous?.contextIds ?? draft.contexts.map((context) => context.id),
      };
      for (const actorId of chapter.actorIds) assertKnownActor(draft, actorId);
      for (const contextId of chapter.contextIds) assertKnownContext(draft, contextId);
      if (index >= 0) draft.chapters[index] = chapter;
      else draft.chapters.push(chapter);
      return;
    }
    case "remove_chapter": {
      const index = draft.chapters.findIndex((chapter) => chapter.id === operation.chapterId);
      if (index < 0) throw new WorldDraftOperationError(`找不到章节：${operation.chapterId}`);
      draft.chapters.splice(index, 1);
      return;
    }
    case "set_runtime_profile":
      if (
        operation.runtimeProfile !== "world_story"
        && operation.runtimeProfile !== "group_chat"
      ) {
        throw new WorldDraftOperationError("runtimeProfile 必须是 world_story 或 group_chat。");
      }
      draft.runtimeProfile = operation.runtimeProfile;
      return;
    case "set_sources": {
      const seen = new Set<string>();
      draft.sources = operation.sources.map((binding) => {
        if (!binding.bundleId.trim()) {
          throw new WorldDraftOperationError("Source bundleId 不能为空。");
        }
        if (seen.has(binding.bundleId)) {
          throw new WorldDraftOperationError(`Source 重复绑定：${binding.bundleId}`);
        }
        seen.add(binding.bundleId);
        if (!Number.isInteger(binding.revision) || binding.revision < 1) {
          throw new WorldDraftOperationError("Source revision 必须是正整数。");
        }
        if (!["strict", "reference", "free"].includes(binding.fidelity)) {
          throw new WorldDraftOperationError("Source fidelity 无效。");
        }
        return { ...binding };
      });
      return;
    }
    default:
      throw new WorldDraftOperationError("包含不支持的草稿操作。");
  }
}

function assertActorUnreferenced(draft: WorldDraft, actorId: string): void {
  const relation = draft.relations.find((item) => (
    item.fromActorId === actorId || item.toActorId === actorId
  ));
  if (relation) throw new WorldDraftOperationError(`Actor 仍被关系 ${relation.id} 引用。`);
  const context = draft.contexts.find((item) => item.actorIds.includes(actorId));
  if (context) throw new WorldDraftOperationError(`Actor 仍被 Context ${context.id} 引用。`);
  const chapter = draft.chapters.find((item) => item.actorIds.includes(actorId));
  if (chapter) throw new WorldDraftOperationError(`Actor 仍被章节 ${chapter.id} 引用。`);
}

function assertKnownActor(draft: WorldDraft, actorId: string): void {
  const known = draft.actors.some((actor) => actor.id === actorId) || draft.player?.id === actorId;
  if (!known) throw new WorldDraftOperationError(`未知 Actor：${actorId}`);
}

function assertKnownContext(draft: WorldDraft, contextId: string): void {
  if (!draft.contexts.some((context) => context.id === contextId)) {
    throw new WorldDraftOperationError(`未知 Context：${contextId}`);
  }
}

function syncContextGroupNames(draft: WorldDraft, previousName: string): void {
  for (const context of draft.contexts) {
    if (
      !context.scene.groupName.trim() ||
      context.scene.groupName === previousName
    ) {
      context.scene.groupName = draft.metadata.name;
    }
  }
}

function assertCharacterCard(value: unknown): asserts value is DraftActor["card"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorldDraftOperationError("actor.card 必须是完整人物卡对象。");
  }
  const card = value as Record<string, unknown>;
  requiredOperationString(card.name, "actor.card.name");
  for (const field of [
    "description",
    "personality",
    "scenario",
    "messageExample",
  ]) {
    operationString(card[field], `actor.card.${field}`);
  }
}

function assertSceneCard(value: unknown): asserts value is DraftContext["scene"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorldDraftOperationError("context.scene 必须是完整场景卡对象。");
  }
  const scene = value as Record<string, unknown>;
  for (const field of ["groupName", "topic", "atmosphere"]) {
    requiredOperationString(scene[field], `context.scene.${field}`);
  }
}

function requiredOperationString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorldDraftOperationError(`${path} 必须是非空字符串。`);
  }
  return value.trim();
}

function operationString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new WorldDraftOperationError(`${path} 必须是字符串。`);
  }
  return value.trim();
}

function defaultIdGenerator(draft: WorldDraft): DraftIdGenerator {
  const used = new Set([
    draft.id,
    ...draft.actors.map((actor) => actor.id),
    ...draft.relations.map((relation) => relation.id),
    ...draft.contexts.map((context) => context.id),
    ...draft.chapters.map((chapter) => chapter.id),
    ...(draft.player ? [draft.player.id] : []),
  ]);
  let sequence = 0;
  return (prefix) => {
    let id = "";
    do id = `${draft.id}:${prefix}:${++sequence}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
}

function normalizeNewIds(
  draft: WorldDraft,
  operations: readonly WorldDraftOperation[],
  idGenerator: DraftIdGenerator,
): WorldDraftOperation[] {
  const aliases = new Map<string, string>();
  const existingActorIds = new Set([
    ...draft.actors.map((actor) => actor.id),
    ...(draft.player ? [draft.player.id] : []),
  ]);
  const existingRelationIds = new Set(draft.relations.map((relation) => relation.id));
  const existingContextIds = new Set(draft.contexts.map((context) => context.id));
  const existingChapterIds = new Set(draft.chapters.map((chapter) => chapter.id));
  const normalized = structuredClone([...operations]) as WorldDraftOperation[];

  for (const operation of normalized) {
    if (operation.type === "upsert_player") {
      const requested = operation.player.id?.trim();
      if (requested && !existingActorIds.has(requested)) {
        const generated = idGenerator("player");
        aliases.set(requested, generated);
        operation.player.id = generated;
        existingActorIds.add(generated);
      } else if (!requested && !draft.player) {
        const generated = idGenerator("player");
        operation.player.id = generated;
        existingActorIds.add(generated);
      }
    } else if (operation.type === "upsert_actor") {
      const requested = operation.actor.id?.trim();
      if (requested && !existingActorIds.has(requested)) {
        const generated = idGenerator("actor");
        aliases.set(requested, generated);
        operation.actor.id = generated;
        existingActorIds.add(generated);
      } else if (!requested) {
        const generated = idGenerator("actor");
        operation.actor.id = generated;
        existingActorIds.add(generated);
      }
    } else if (operation.type === "upsert_context") {
      const requested = operation.context.id?.trim();
      if (requested && !existingContextIds.has(requested)) {
        const generated = idGenerator("context");
        aliases.set(requested, generated);
        operation.context.id = generated;
        existingContextIds.add(generated);
      } else if (!requested) {
        const generated = idGenerator("context");
        operation.context.id = generated;
        existingContextIds.add(generated);
      }
    } else if (operation.type === "upsert_relation") {
      const requested = operation.relation.id?.trim();
      if (!requested || !existingRelationIds.has(requested)) {
        const generated = idGenerator("relation");
        if (requested) aliases.set(requested, generated);
        operation.relation.id = generated;
        existingRelationIds.add(generated);
      }
    } else if (operation.type === "upsert_chapter") {
      const requested = operation.chapter.id?.trim();
      if (!requested || !existingChapterIds.has(requested)) {
        const generated = idGenerator("chapter");
        if (requested) aliases.set(requested, generated);
        operation.chapter.id = generated;
        existingChapterIds.add(generated);
      }
    }
  }

  for (const operation of normalized) {
    if (operation.type === "upsert_context") {
      if (operation.context.actorIds) {
        operation.context.actorIds = operation.context.actorIds.map((id) => aliases.get(id) ?? id);
      }
      if (operation.context.presentation?.playerActorId) {
        operation.context.presentation.playerActorId = aliases.get(
          operation.context.presentation.playerActorId,
        ) ?? operation.context.presentation.playerActorId;
      }
    } else if (operation.type === "upsert_relation") {
      operation.relation.fromActorId = aliases.get(operation.relation.fromActorId)
        ?? operation.relation.fromActorId;
      operation.relation.toActorId = aliases.get(operation.relation.toActorId)
        ?? operation.relation.toActorId;
    } else if (operation.type === "upsert_chapter") {
      if (operation.chapter.actorIds) {
        operation.chapter.actorIds = operation.chapter.actorIds.map((id) => aliases.get(id) ?? id);
      }
      if (operation.chapter.contextIds) {
        operation.chapter.contextIds = operation.chapter.contextIds.map((id) => aliases.get(id) ?? id);
      }
    } else if (operation.type === "remove_actor") {
      operation.actorId = aliases.get(operation.actorId) ?? operation.actorId;
    }
  }
  return normalized;
}

function cleanDefined<T extends object>(value: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}
