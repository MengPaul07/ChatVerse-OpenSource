import type { PlayerCharacterCard, WorldActorDefinition, WorldContextDefinition, WorldDefinition } from "../../../contracts/world.js";

export function normalizeWorldDefinition(input: WorldDefinition): WorldDefinition {
  if (!input.metadata.id.trim()) throw new Error("World metadata.id is required.");
  if (!input.metadata.name.trim()) throw new Error("World metadata.name is required.");
  const sources = normalizeWorldSourceBindings(input.sources);
  const actorIds = new Set<string>();
  for (const actor of input.actors) {
    if (!actor.id.trim()) throw new Error("World actor id is required.");
    if (actorIds.has(actor.id)) throw new Error(`Duplicate world actor id: ${actor.id}`);
    actorIds.add(actor.id);
  }
  const contextIds = new Set<string>();
  for (const context of input.contexts) {
    if (!context.id.trim()) throw new Error("World context id is required.");
    if (contextIds.has(context.id)) throw new Error(`Duplicate world context id: ${context.id}`);
    contextIds.add(context.id);
    for (const actorId of context.actorIds) {
      if (!actorIds.has(actorId)) throw new Error(`Context ${context.id} references unknown actor ${actorId}`);
    }
    if (context.presentation?.kind === "galgame") {
      const player = input.actors.find((actor) => actor.id === context.presentation!.playerActorId);
      if (!player || !isPlayerControlledActor(player) || !context.actorIds.includes(player.id)) {
        throw new Error(`Galgame context ${context.id} requires a joined player-controlled Actor.`);
      }
    }
  }
  const chapterIds = new Set<string>();
  const activeChapterByContext = new Set<string>();
  for (const chapter of input.chapters ?? []) {
    if (!chapter.id.trim()) throw new Error("World chapter id is required.");
    if (chapterIds.has(chapter.id)) throw new Error(`Duplicate world chapter id: ${chapter.id}`);
    chapterIds.add(chapter.id);
    if (!isChapterStatus(chapter.status)) {
      throw new Error(`Unsupported world chapter status: ${String(chapter.status)}`);
    }
    for (const actorId of chapter.actorIds) {
      if (!actorIds.has(actorId)) throw new Error(`Chapter ${chapter.id} references unknown actor ${actorId}`);
    }
    for (const contextId of chapter.contextIds) {
      if (!contextIds.has(contextId)) throw new Error(`Chapter ${chapter.id} references unknown context ${contextId}`);
      if (chapter.status === "active" && activeChapterByContext.has(contextId)) {
        throw new Error(`Context ${contextId} has more than one active chapter.`);
      }
      if (chapter.status === "active") activeChapterByContext.add(contextId);
    }
  }
  return {
    ...input,
    metadata: { ...input.metadata },
    sources,
    actors: input.actors.map((actor) => ({
      ...actor,
      card: { ...actor.card },
      playerCard: actor.playerCard ? {
        ...actor.playerCard,
        visual: actor.playerCard.visual ? { ...actor.playerCard.visual } : undefined,
      } : undefined,
      initialState: actor.initialState ? { ...actor.initialState } : undefined,
      control: actor.control ? { ...actor.control } : undefined,
    })),
    contexts: input.contexts.map((context) => ({
      ...context,
      actorIds: unique(context.actorIds),
      runtime: context.runtime ? {
        ...context.runtime,
        actorRuntime: context.runtime.actorRuntime ? { ...context.runtime.actorRuntime } : undefined,
      } : undefined,
      presentation: context.presentation ? { ...context.presentation } : undefined,
      scene: {
        ...context.scene,
        groupName: context.scene.groupName || context.name,
        rules: context.scene.rules ? [...context.scene.rules] : undefined,
      },
    })),
    relations: input.relations?.map((relation) => ({ ...relation })) ?? [],
    chapters: input.chapters?.map((chapter) => ({
      ...chapter,
      actorIds: [...chapter.actorIds],
      contextIds: [...chapter.contextIds],
      beatIds: [...chapter.beatIds],
    })) ?? [],
  };
}

function isChapterStatus(value: unknown): value is "queued" | "active" | "completed" | "abandoned" {
  return value === "queued" || value === "active" || value === "completed" || value === "abandoned";
}

export function isConversationContext(context: WorldContextDefinition): boolean {
  return context.conversationMode === "group" || context.conversationMode === "private";
}

export function isPrivateConversationContext(context: WorldContextDefinition): boolean {
  return context.conversationMode === "private";
}

export function isPlayerControlledActor(actor: WorldActorDefinition): boolean {
  return actor.playerControlled === true;
}

export function actorDisplayName(actor: WorldActorDefinition): string {
  return actor.card.name;
}

export function playerParticipantForActor(actor: WorldActorDefinition): { name: string; card?: string } {
  return {
    name: actor.playerCard?.name ?? actor.card.name,
    card: actor.playerCard ? publicPlayerDescription(actor.playerCard) : actor.card.description,
  };
}

export function characterCardFromPlayerCard(
  card: PlayerCharacterCard,
  previous?: Extract<WorldActorDefinition, { kind: "character" }>["card"],
): Extract<WorldActorDefinition, { kind: "character" }>["card"] {
  return {
    name: card.name,
    description: `${card.identity}。${card.background}`,
    personality: card.personality,
    scenario: card.background,
    messageExample: previous?.messageExample?.trim() || `表达方式：${card.speechStyle}`,
    instructions: `表达方式：${card.speechStyle}\n行为边界：${card.boundaries}`,
    loreBook: previous?.loreBook,
    visual: card.visual ? { ...card.visual } : previous?.visual,
  };
}

export function normalizePlayerCard(card: PlayerCharacterCard): PlayerCharacterCard {
  const normalized: PlayerCharacterCard = {
    name: card.name.trim(), identity: card.identity.trim(), background: card.background.trim(),
    personality: card.personality.trim(), appearance: card.appearance.trim(),
    speechStyle: card.speechStyle.trim(), boundaries: card.boundaries.trim(),
    visual: card.visual ? { ...card.visual, appearance: card.visual.appearance.trim() } : undefined,
  };
  const missing = Object.entries(normalized)
    .filter(([key, value]) => key !== "visual" && typeof value === "string" && !value)
    .map(([key]) => key);
  if (missing.length > 0) throw new Error(`Player card is incomplete: ${missing.join(", ")}`);
  return normalized;
}

export function publicPlayerDescription(card: PlayerCharacterCard): string {
  return [card.identity, card.appearance, card.background].filter(Boolean).join("；");
}

function normalizeWorldSourceBindings(
  bindings: readonly NonNullable<WorldDefinition["sources"]>[number][] | undefined,
): NonNullable<WorldDefinition["sources"]> {
  const seen = new Set<string>();
  return (bindings ?? []).map((binding) => {
    const bundleId = binding.bundleId.trim();
    if (!bundleId) throw new Error("World Source bundleId is required.");
    if (seen.has(bundleId)) throw new Error(`World Source bundle is bound more than once: ${bundleId}`);
    seen.add(bundleId);
    if (!Number.isInteger(binding.revision) || binding.revision < 1) {
      throw new Error(`World Source revision must be a positive integer: ${bundleId}`);
    }
    if (!["strict", "reference", "free"].includes(binding.fidelity)) {
      throw new Error(`Unsupported World Source fidelity: ${String(binding.fidelity)}`);
    }
    return { ...binding, bundleId };
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
