import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../contracts/chat.js";
import {
  createConversationDigest,
  getUnsummarizedMessages,
  projectConversationHistory,
  selectCompressionCandidate,
} from "./conversation.js";

function message(id: string, text: string): ChatMessage {
  return { id, characterName: "Alice", message: text, source: "character", timestamp: 1 };
}

describe("conversation compression projection", () => {
  it("keeps a raw recent window when selecting the compressible prefix", () => {
    const messages = [message("a", "a".repeat(90)), message("b", "b".repeat(90)), message("c", "c".repeat(90))];
    const candidate = selectCompressionCandidate(messages, createConversationDigest(), 40);

    expect(candidate.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("switches from raw history to digest plus the unsummarized tail", () => {
    const messages = [message("a", "first"), message("b", "second"), message("c", "third")];
    const digest = createConversationDigest({ summary: "first two messages", recentFacts: ["A fact"], throughMessageId: "b" });

    expect(getUnsummarizedMessages(messages, digest).map((item) => item.id)).toEqual(["c"]);
    expect(projectConversationHistory(messages, digest).compressedMessageCount).toBe(2);
  });

  it("falls back to raw history when a checkpoint is stale", () => {
    const messages = [message("a", "first")];
    const digest = createConversationDigest({ throughMessageId: "missing" });

    expect(getUnsummarizedMessages(messages, digest)).toEqual(messages);
  });
});
