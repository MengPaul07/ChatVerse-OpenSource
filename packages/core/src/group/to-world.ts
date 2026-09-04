import type { WorldDefinition } from "../contracts/world.js";
import {
  defineGroupCard,
  type GroupCard,
} from "./index.js";
import { resolveGroupRuntimeConfig } from "./runtime-config.js";

export function worldDefinitionFromGroup(groupInput: GroupCard): WorldDefinition {
  const group = defineGroupCard(groupInput);
  const worldId = group.worldRef?.worldId.trim()
    || group.metadata.id?.trim()
    || `group:${slugify(group.metadata.name)}`;
  const contextId = group.worldRef?.contextId.trim() || `${worldId}:context:main`;
  const characterActors = group.characters.map((card, index) => ({
    id: `${worldId}:actor:${index + 1}`,
    kind: "character" as const,
    card,
  }));
  const playerActors = (group.userProfiles ?? []).map((profile, index) => ({
    id: `${worldId}:player:${index + 1}`,
    kind: "character" as const,
    playerControlled: true,
    card: {
      name: profile.name,
      description: profile.card || "群聊中的用户参与者。",
      personality: "由用户自行决定。",
      scenario: profile.card || "正在参与当前群聊。",
      messageExample: "",
    },
  }));
  const actorIdByName = new Map<string, string>();
  for (const actor of characterActors) actorIdByName.set(actor.card.name, actor.id);
  for (const actor of playerActors) actorIdByName.set(actor.card.name, actor.id);
  const sourceRelations = group.relations?.relations ?? [];
  const runtime = resolveGroupRuntimeConfig(group.runtime);

  return {
    metadata: {
      id: worldId,
      name: group.metadata.name,
      description: group.metadata.description,
      version: group.metadata.version,
    },
    lore: group.worldBook,
    actors: [...characterActors, ...playerActors],
    contexts: [{
      id: contextId,
      kind: "chat",
      name: group.metadata.name,
      actorIds: [...characterActors, ...playerActors].map((actor) => actor.id),
      scene: group.scene,
      initiallyActive: true,
      conversationMode: "group",
      runtime: {
        pacingMultiplier: runtime.pacing.multiplier,
        interventionCommitWindowMs: runtime.interaction.interventionCommitWindowMs,
        forceSpeakAfterConsecutiveSilents: runtime.harness.forceSpeakAfterConsecutiveSilents,
        messageStyle: runtime.messageStyle,
        contextCompression: runtime.contextCompression,
        actorRuntime: {
          activation: "autonomous_idle",
          playerRouting: "focus_actor",
          ambient: "off",
        },
      },
    }],
    relations: sourceRelations.flatMap((relation) => {
      const fromActorId = actorIdByName.get(relation.from);
      const toActorId = actorIdByName.get(relation.to);
      return fromActorId && toActorId
        ? [{ fromActorId, toActorId, description: relation.description }]
        : [];
    }),
    directorPolicy: {
      enabled: false,
    },
    actorMemoryPolicy: {
      enabled: false,
    },
  };
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "")
    .replace(/-+/g, "-");
  return slug || "world";
}
