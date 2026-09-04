import type { GroupCard } from "@chatverse/core";
import { defineGroupCard } from "@chatverse/core";
import {
  WORLD_DRAFT_SCHEMA_VERSION,
  type DraftActor,
  type DraftPlayer,
  type DraftRelation,
  type WorldDraft,
  type WorldDraftRuntimeProfile,
} from "./types.js";

export type { DraftIdGenerator } from "./draft/contracts.js";

export function createEmptyWorldDraft(input: {
  id: string;
  name?: string;
  runtimeProfile?: WorldDraftRuntimeProfile;
}): WorldDraft {
  const name = cleanText(input.name) || "未命名世界";
  return {
    schemaVersion: WORLD_DRAFT_SCHEMA_VERSION,
    id: input.id,
    revision: 0,
    metadata: {
      name,
      description: "",
    },
    premise: "",
    lore: {
      core: "",
      rules: [],
    },
    actors: [],
    relations: [],
    contexts: [{
      id: `${input.id}:context:main`,
      name,
      actorIds: [],
      scene: {
        groupName: name,
        topic: "故事开始",
        atmosphere: "等待故事发生",
        state: "flowing",
        rules: [],
      },
      opening: "",
    }],
    chapters: [],
    sources: [],
    runtimeProfile: input.runtimeProfile ?? "world_story",
  };
}

export function worldDraftFromGroupCard(
  input: GroupCard,
  options: { draftId?: string } = {},
): WorldDraft {
  const group = defineGroupCard(input);
  const draftId = options.draftId ?? group.metadata.id ?? `draft:${slugify(group.metadata.name)}`;
  const actorIdByName = new Map<string, string>();
  const actors = group.characters.map((card, index): DraftActor => {
    const id = `${draftId}:actor:${index + 1}`;
    actorIdByName.set(card.name, id);
    return {
      id,
      role: index === 0 ? "lead" : "support",
      card: structuredClone(card),
      background: card.scenario,
    };
  });
  const sourcePlayer = group.userProfiles?.[0];
  const player: DraftPlayer | undefined = sourcePlayer
    ? {
        id: `${draftId}:player:1`,
        profile: structuredClone(sourcePlayer),
        mode: "participant",
      }
    : undefined;
  if (player) actorIdByName.set(player.profile.name, player.id);
  const contextId = `${draftId}:context:main`;
  const relationsSource = group.relations?.relations ?? [];
  const relations = relationsSource.flatMap((relation, index): DraftRelation[] => {
    const fromActorId = actorIdByName.get(relation.from);
    const toActorId = actorIdByName.get(relation.to);
    return fromActorId && toActorId
      ? [{
          id: `${draftId}:relation:${index + 1}`,
          fromActorId,
          toActorId,
          description: relation.description,
        }]
      : [];
  });
  const opening = [group.scene.atmosphere, group.scene.topic].filter(Boolean).join("\n");
  return {
    schemaVersion: WORLD_DRAFT_SCHEMA_VERSION,
    id: draftId,
    revision: 0,
    metadata: {
      name: group.metadata.name,
      description: group.metadata.description?.trim()
        || group.scene.topic,
      tags: group.metadata.tags ? [...group.metadata.tags] : undefined,
    },
    premise: group.scene.topic,
    lore: {
      core: group.worldBook?.description ?? "",
      rules: [...(group.scene.rules ?? [])],
    },
    player,
    actors,
    relations,
    contexts: [{
      id: contextId,
      name: group.metadata.name,
      actorIds: [
        ...actors.map((actor) => actor.id),
        ...(player ? [player.id] : []),
      ],
      scene: structuredClone(group.scene),
      opening,
      lore: group.worldBook ? structuredClone(group.worldBook) : undefined,
    }],
    chapters: [],
    sources: [],
    runtimeProfile: "group_chat",
  };
}

export {
  applyWorldDraftOperations,
  WorldDraftOperationError,
  WorldDraftRevisionError,
} from "./draft/operation-applier.js";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "")
    .replace(/-+/g, "-") || "world";
}
