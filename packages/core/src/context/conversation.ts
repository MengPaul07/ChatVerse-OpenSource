import type { ChatMessage } from "../contracts/chat.js";
import type { ConversationDigest } from "../contracts/conversation.js";
import { estimateTokens } from "./token.js";

/**
 * A compact, LLM-produced view of the older part of a conversation.
 * Raw messages remain in Session and are never deleted by compression.
 */
export type { ConversationDigest } from "../contracts/conversation.js";

export interface HistoryProjection {
  digest: ConversationDigest;
  recentMessages: ChatMessage[];
  compressedMessageCount: number;
}

export function createConversationDigest(initial?: Partial<ConversationDigest>): ConversationDigest {
  return {
    summary: initial?.summary?.trim() ?? "",
    recentFacts: normalizeFacts(initial?.recentFacts ?? [], Number.POSITIVE_INFINITY),
    throughMessageId: initial?.throughMessageId,
  };
}

/** Messages not represented by the current digest. */
export function getUnsummarizedMessages(
  messages: readonly ChatMessage[],
  digest: ConversationDigest,
): ChatMessage[] {
  if (!digest.throughMessageId) return [...messages];
  const index = messages.findIndex((message) => message.id === digest.throughMessageId);
  // A stale checkpoint must not hide messages from a prompt.
  return index === -1 ? [...messages] : messages.slice(index + 1);
}

/**
 * Select the oldest unsummarized prefix that can be safely compressed while
 * retaining a raw recent-history window for immediate conversational nuance.
 */
export function selectCompressionCandidate(
  messages: readonly ChatMessage[],
  digest: ConversationDigest,
  recentHistoryTokens: number,
): ChatMessage[] {
  const unsummarized = getUnsummarizedMessages(messages, digest);
  let retainedTokens = 0;
  let boundary = unsummarized.length;

  for (let index = unsummarized.length - 1; index >= 0; index--) {
    const tokens = estimateTokens(formatHistoryMessage(unsummarized[index]!));
    if (retainedTokens + tokens > recentHistoryTokens && index < unsummarized.length - 1) {
      boundary = index + 1;
      break;
    }
    retainedTokens += tokens;
    boundary = index;
  }

  return unsummarized.slice(0, boundary);
}

/** Build the history portion of an Agent prompt after a successful cold switch. */
export function projectConversationHistory(
  messages: readonly ChatMessage[],
  digest: ConversationDigest,
): HistoryProjection {
  const recentMessages = getUnsummarizedMessages(messages, digest);
  return {
    digest,
    recentMessages,
    compressedMessageCount: Math.max(0, messages.length - recentMessages.length),
  };
}

export function formatHistoryMessage(message: ChatMessage): string {
  const source = message.source === "human" ? "（真人）" : "";
  return `【${message.characterName}${source}】：${message.message}`;
}

export function normalizeFacts(values: readonly unknown[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const fact = value.trim().replace(/\s+/g, " ");
    if (!fact || fact.length > 240 || seen.has(fact)) continue;
    seen.add(fact);
    result.push(fact);
    if (result.length >= limit) break;
  }
  return result;
}
