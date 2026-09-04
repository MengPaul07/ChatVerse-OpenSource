import type {
  GroupCard,
  LoreBook,
  Relation,
  WorldDefinition,
} from "@chatverse/core";
import { defineGroupCard } from "@chatverse/core";
import type { WorldDraft } from "./types.js";
import { validateWorldDraft } from "./validation.js";

export interface CompileWorldDraftOptions {
  now?: number;
}

export function compileWorldDraft(
  draft: WorldDraft,
  options: CompileWorldDraftOptions = {},
): WorldDefinition {
  assertCompilable(draft);
  void options.now;
  const worldLore = loreBookFromDraft(draft);
  return {
    metadata: {
      id: draft.id,
      name: draft.metadata.name,
      description: draft.metadata.description,
      version: `draft-${draft.revision}`,
    },
    lore: worldLore,
    sources: draft.sources?.map((binding) => ({ ...binding })),
    actors: [
      ...draft.actors.map((actor) => ({
        id: actor.id,
        kind: "character" as const,
        card: structuredClone(actor.card),
        background: actor.background?.trim() || actor.card.scenario,
      })),
      ...(draft.player
        ? [{
            id: draft.player.id,
            kind: "character" as const,
            card: playerCharacterCard(draft.player),
            playerControlled: true,
            playerCard: draft.player.playerCard ? structuredClone(draft.player.playerCard) : undefined,
          }]
        : []),
    ],
    contexts: draft.contexts.map((context) => {
      return {
        id: context.id,
        kind: "chat" as const,
        name: context.name,
        actorIds: [...context.actorIds],
        scene: {
          ...structuredClone(context.scene),
          groupName: context.scene.groupName || context.name,
          atmosphere: context.opening,
        },
        lore: context.lore ? structuredClone(context.lore) : undefined,
        conversationMode: draft.runtimeProfile === "group_chat" ? "group" as const : undefined,
        presentation: context.presentation
          ? structuredClone(context.presentation)
          : draft.runtimeProfile === "world_story" && draft.player
            ? {
                kind: "galgame" as const,
                playerActorId: draft.player.id,
                artDirection: draft.metadata.tone?.trim() || "沉浸式叙事插画，强调角色表演、现场空间和清晰的视觉焦点。",
                backgroundGeneration: "auto" as const,
                acknowledgement: "required" as const,
              }
            : undefined,
        initiallyActive: true,
        runtime: draft.runtimeProfile === "world_story"
          ? {
              pacingMultiplier: 1,
              messageStyle: {
                maxBurstCount: 3,
                allowStickers: true,
                preferShortMessages: true,
              },
              actorRuntime: {
                activation: "beat_runtime",
                playerRouting: "focus_actor",
                ambient: "low",
              },
              beatRuntime: {
                presentationPrefetchLimit: 5,
              },
            }
          : {
              pacingMultiplier: 1,
              messageStyle: {
                maxBurstCount: 3,
                allowStickers: true,
                preferShortMessages: true,
              },
              actorRuntime: {
                activation: "autonomous_idle",
                playerRouting: "focus_actor",
                ambient: "off",
              },
            },
      };
    }),
    relations: draft.relations.map((relation) => ({
      fromActorId: relation.fromActorId,
      toActorId: relation.toActorId,
      description: relation.description,
    })),
    chapters: draft.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      treatment: chapter.treatment,
      targetOutcome: chapter.targetOutcome,
      status: chapter.status,
      actorIds: [...chapter.actorIds],
      contextIds: [...chapter.contextIds],
      beatIds: [],
    })),
    directorPolicy: {
      enabled: draft.runtimeProfile === "world_story",
    },
    actorMemoryPolicy: {
      enabled: draft.runtimeProfile === "world_story",
    },
  };
}

function playerCharacterCard(player: NonNullable<WorldDraft["player"]>) {
  const card = player.playerCard;
  return {
    name: card?.name?.trim() || player.profile.name,
    description: card
      ? `${card.identity}。${card.background}`
      : player.profile.card || "由用户亲自扮演的世界参与者。",
    personality: card?.personality || "由用户自行决定。",
    scenario: card?.background || player.profile.card || "身处当前世界。",
    messageExample: card?.speechStyle ? `表达方式：${card.speechStyle}` : "",
    instructions: card ? `表达方式：${card.speechStyle}\n行为边界：${card.boundaries}` : undefined,
    visual: card?.visual ? { ...card.visual } : undefined,
  };
}

export function compileGroupCardFromWorldDraft(draft: WorldDraft): GroupCard {
  assertCompilable(draft);
  const context = draft.contexts[0]!;
  const nameById = new Map<string, string>([
    ...draft.actors.map((actor): [string, string] => [actor.id, actor.card.name]),
    ...(draft.player
      ? [[draft.player.id, draft.player.profile.name] as [string, string]]
      : []),
  ]);
  const relations = draft.relations.flatMap((relation): Relation[] => {
    const from = nameById.get(relation.fromActorId);
    const to = nameById.get(relation.toActorId);
    return from && to
      ? [{ from, to, description: relation.description }]
      : [];
  });
  return defineGroupCard({
    kind: "chatverse.group",
    schemaVersion: 1,
    worldRef: {
      worldId: draft.id,
      contextId: context.id,
    },
    metadata: {
      id: draft.id,
      name: draft.metadata.name,
      description: draft.metadata.description,
      tags: draft.metadata.tags ? [...draft.metadata.tags] : undefined,
      version: `draft-${draft.revision}`,
    },
    characters: draft.actors.map((actor) => structuredClone(actor.card)),
    userProfiles: draft.player ? [structuredClone(draft.player.profile)] : [],
    scene: {
      ...structuredClone(context.scene),
      groupName: draft.metadata.name,
    },
    worldBook: loreBookFromDraft(draft),
    relations: { relations },
  });
}

function loreBookFromDraft(draft: WorldDraft): LoreBook | undefined {
  const entries = [
    ...(draft.lore.core.trim()
      ? [{
          keys: [],
          content: draft.lore.core.trim(),
          priority: 100,
          position: "before" as const,
          constant: true,
        }]
      : []),
    ...draft.lore.rules.map((rule, index) => ({
      keys: [],
      content: rule,
      priority: 90 - index,
      position: "before" as const,
      constant: true,
    })),
  ];
  return entries.length
    ? {
        name: `${draft.metadata.name} 世界背景`,
        description: draft.lore.core,
        entries,
      }
    : undefined;
}

function assertCompilable(draft: WorldDraft): void {
  const validation = validateWorldDraft(draft);
  if (validation.valid) return;
  const message = validation.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message)
    .join("；");
  throw new Error(`WorldDraft 无法编译：${message}`);
}
