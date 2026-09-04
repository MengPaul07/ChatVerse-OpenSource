import type { ChatMessage, CharacterCard } from "../../contracts/chat.js";
import type { HarnessTriggerInput } from "./trigger-queue.js";

/** Derive only actionable direct mentions from a committed chat message. */
export function deriveDirectMentionTriggers(
  message: ChatMessage,
  characters: readonly CharacterCard[],
): HarnessTriggerInput[] {
  const source = message.source === "human" ? "user" as const : "character" as const;
  const triggers: HarnessTriggerInput[] = [];

  for (const character of characters) {
    const escapedName = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`@${escapedName}`).test(message.message)) continue;
    triggers.push({
      type: "mention",
      target: character.name,
      source,
      messageId: message.id,
      message: message.message,
      priority: 95,
    });
  }

  return triggers;
}
