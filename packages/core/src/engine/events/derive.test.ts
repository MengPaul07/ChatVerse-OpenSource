import { describe, expect, it } from "vitest";
import type { CharacterCard, ChatMessage } from "../../contracts/chat.js";
import { deriveDirectMentionTriggers } from "./derive.js";

const characters: CharacterCard[] = [
  {
    name: "Alice",
    description: "",
    personality: "",
    scenario: "",
    messageExample: "",
  },
  {
    name: "A.B",
    description: "",
    personality: "",
    scenario: "",
    messageExample: "",
  },
];

describe("deriveDirectMentionTriggers", () => {
  it("creates one trigger per explicitly mentioned character", () => {
    const message: ChatMessage = {
      id: "message-1",
      characterName: "Tester",
      message: "@Alice 看一下，@A.B 也来。",
      timestamp: 1,
      source: "human",
    };

    expect(deriveDirectMentionTriggers(message, characters)).toEqual([
      {
        type: "mention",
        target: "Alice",
        source: "user",
        messageId: "message-1",
        message: message.message,
        priority: 95,
      },
      {
        type: "mention",
        target: "A.B",
        source: "user",
        messageId: "message-1",
        message: message.message,
        priority: 95,
      },
    ]);
  });

  it("does not treat an unprefixed name as a mention", () => {
    const message: ChatMessage = {
      id: "message-2",
      characterName: "Alice",
      message: "Alice 已经看过了。",
      timestamp: 2,
      source: "character",
    };

    expect(deriveDirectMentionTriggers(message, characters)).toEqual([]);
  });
});
