import type {
  DraftResearchSource,
  WorldDraft,
  WorldDraftOperation,
} from "../types.js";

export function inspectDraft(
  draft: WorldDraft,
  sections: string[],
  ids: string[],
): Record<string, unknown> {
  const requested = new Set(sections);
  const includeAll = requested.size === 0;
  const selectedIds = new Set(ids);
  const include = (section: string) => includeAll || requested.has(section);
  return {
    revision: draft.revision,
    ...(include("metadata") ? { metadata: draft.metadata, premise: draft.premise } : {}),
    ...(include("lore") ? { lore: draft.lore } : {}),
    ...(include("player") ? { player: draft.player } : {}),
    ...(include("actors") ? { actors: filterById(draft.actors, selectedIds) } : {}),
    ...(include("relations") ? { relations: filterById(draft.relations, selectedIds) } : {}),
    ...(include("contexts") ? { contexts: filterById(draft.contexts, selectedIds) } : {}),
    ...(include("chapters") ? { chapters: filterById(draft.chapters, selectedIds) } : {}),
    ...(include("sources") ? { sources: draft.sources ?? [] } : {}),
    ...(include("runtime") ? { runtimeProfile: draft.runtimeProfile } : {}),
  };
}

export function draftIndex(draft: WorldDraft): Record<string, unknown> {
  return {
    id: draft.id,
    revision: draft.revision,
    metadata: draft.metadata,
    premise: draft.premise,
    runtimeProfile: draft.runtimeProfile,
    sources: draft.sources ?? [],
    player: draft.player
      ? { id: draft.player.id, name: draft.player.profile.name, mode: draft.player.mode }
      : undefined,
    actors: draft.actors.map((actor) => ({
      id: actor.id,
      name: actor.card.name,
      role: actor.role,
      description: actor.card.description,
    })),
    relations: draft.relations.map((relation) => ({
      id: relation.id,
      fromActorId: relation.fromActorId,
      toActorId: relation.toActorId,
    })),
    contexts: draft.contexts.map((context) => ({
      id: context.id,
      name: context.name,
      actorIds: context.actorIds,
      topic: context.scene.topic,
    })),
    chapters: draft.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      status: chapter.status,
      treatment: chapter.treatment,
      targetOutcome: chapter.targetOutcome,
      actorIds: chapter.actorIds,
      contextIds: chapter.contextIds,
    })),
  };
}

export function mergeResearchSources(
  existing: readonly DraftResearchSource[] | undefined,
  incoming: readonly DraftResearchSource[],
): DraftResearchSource[] {
  const merged = new Map<string, DraftResearchSource>();
  for (const source of [...(existing ?? []), ...incoming]) {
    if (!source.url) continue;
    merged.set(source.url, structuredClone(source));
  }
  return [...merged.values()].slice(-50);
}

export function summarizeOperations(operations: readonly WorldDraftOperation[]): string {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    counts.set(operation.type, (counts.get(operation.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => `${operationLabel(type)} ${count} 项`)
    .join("，");
}

function operationLabel(type: string): string {
  if (type.includes("actor")) return type.startsWith("remove") ? "删除角色" : "修改角色";
  if (type.includes("relation")) return type.startsWith("remove") ? "删除关系" : "修改关系";
  if (type.includes("context")) return "修改开场";
  if (type.includes("chapter")) return type.startsWith("remove") ? "删除章节" : "修改章节";
  if (type.includes("player")) return "修改玩家角色";
  if (type === "set_lore") return "修改世界背景";
  if (type === "set_metadata" || type === "set_premise") return "修改世界设定";
  return "修改运行模式";
}

function filterById<T extends { id: string }>(
  values: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] {
  return structuredClone(
    selectedIds.size
      ? values.filter((value) => selectedIds.has(value.id))
      : [...values],
  );
}
