import type { WorldDefinition } from "../contracts/world.js";
import type { Relation, SceneCard } from "../contracts/chat.js";
import type {
  GroupCard,
  GroupWorldReference,
} from "./index.js";
import { defineGroupCard } from "./index.js";

export interface GroupCardFromWorldOptions {
  /** Selects a chat context; defaults to the first chat context. */
  contextId?: string;
  /** Gives a deterministic identity to the materialized GroupCard. */
  groupId?: string;
}

/**
 * Materializes one World chat context as a GroupCard view.
 *
 * The World remains the source of truth. The returned card is a portable
 * context snapshot and carries `worldRef` so callers can keep the relationship.
 */
export function groupCardFromWorldDefinition(
  definition: WorldDefinition,
  options: GroupCardFromWorldOptions = {},
): GroupCard {
  const context = options.contextId
    ? definition.contexts.find((item) => item.id === options.contextId)
    : definition.contexts.find((item) => item.kind === "chat");
  if (!context || context.kind !== "chat") {
    throw new Error(`找不到可转换为群聊的 World Context：${options.contextId ?? "默认"}`);
  }

  const actorIds = new Set(context.actorIds);
  const actors = definition.actors.filter((actor) => actorIds.has(actor.id));
  const characters = actors
    .filter((actor) => actor.playerControlled !== true)
    .map((actor) => structuredClone(actor.card));
  const userProfiles = actors
    .filter((actor) => actor.playerControlled === true)
    .map((actor) => ({ name: actor.card.name, card: actor.card.description }));
  const nameById = new Map(actors.map((actor) => [actor.id, actor.card.name]));
  const relations: Relation[] = (definition.relations ?? []).flatMap((relation) => {
    const from = nameById.get(relation.fromActorId);
    const to = nameById.get(relation.toActorId);
    return from && to
      ? [{ from, to, description: relation.description }]
      : [];
  });
  const worldRef: GroupWorldReference = {
    worldId: definition.metadata.id,
    contextId: context.id,
  };
  const groupName = context.name || definition.metadata.name;
  const runtime = context.runtime;

  return defineGroupCard({
    kind: "chatverse.group",
    schemaVersion: 1,
    worldRef,
    metadata: {
      id: options.groupId?.trim() || `group:${definition.metadata.id}:${context.id}`,
      name: groupName,
      description: definition.metadata.description,
      version: definition.metadata.version,
    },
    characters,
    userProfiles,
    scene: {
      ...structuredClone(context.scene),
      groupName,
    } as SceneCard,
    worldBook: context.lore ? structuredClone(context.lore) : definition.lore ? structuredClone(definition.lore) : undefined,
    relations: { relations },
    runtime: {
      pacing: { multiplier: runtime?.pacingMultiplier },
      messageStyle: runtime?.messageStyle ? structuredClone(runtime.messageStyle) : undefined,
      interaction: runtime?.interventionCommitWindowMs === undefined
        ? undefined
        : { interventionCommitWindowMs: runtime.interventionCommitWindowMs },
      contextCompression: runtime?.contextCompression ? structuredClone(runtime.contextCompression) : undefined,
    },
  });
}
