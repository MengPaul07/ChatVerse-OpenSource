import type { ActorAction, CharacterCard, CharacterState, SceneCard, ChatMessage } from "../contracts/chat.js";
import { createConversationDigest } from "../context/conversation.js";
import type { ConversationDigest } from "../context/conversation.js";

export type ActiveScene = SceneCard & {
  state: NonNullable<SceneCard["state"]>;
};

/**
 * Mutable, committed session data.
 *
 * Scheduling, providers, and lifecycle control intentionally stay outside
 * this class. That keeps snapshots and future persistence scoped to data that
 * has already become part of the conversation.
 */
export class SessionState {
  readonly messages: ChatMessage[] = [];
  readonly actions: ActorAction[] = [];
  readonly characterStates = new Map<string, CharacterState>();
  scene: ActiveScene;
  conversationDigest: ConversationDigest = createConversationDigest();

  constructor(input: {
    characters: CharacterCard[];
    initialMessages?: readonly ChatMessage[];
    initialActions?: readonly ActorAction[];
    scene: SceneCard;
    now: () => number;
  }) {
    this.scene = {
      ...input.scene,
      state: input.scene.state ?? "flowing",
    };
    this.messages.push(...(input.initialMessages ?? []).map((message) => ({ ...message })));
    this.actions.push(...(input.initialActions ?? []).map((action) => ({ ...action })));

    for (const character of input.characters) {
      this.characterStates.set(character.name, {
        characterName: character.name,
        availability: "available",
        attention: "active",
        updatedAt: input.now(),
        source: "system",
      });
    }
  }
}
