import type {
  CharacterCard,
  SessionMessageStyleConfig,
} from "../../contracts/chat.js";
import type { ChatProvider } from "../../contracts/provider.js";
import type { HumanParticipant } from "../input/index.js";
import type { AgentDecision } from "../harness/index.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeMessageStyle(
  input: SessionMessageStyleConfig | undefined,
): Required<SessionMessageStyleConfig> {
  return {
    maxBurstCount: Math.max(1, Math.min(3, Math.round(input?.maxBurstCount ?? 3))),
    allowStickers: input?.allowStickers ?? true,
    preferShortMessages: input?.preferShortMessages ?? true,
  };
}

/** 基于种子的稳定抖动，返回 [-rangeSec, +rangeSec] 的值。同种子同结果，不用 Math.random。*/
export function stableJitter(seed: string, rangeSec: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const normalized = (hash & 0x7fffffff) / 0x7fffffff;
  return (normalized * 2 - 1) * rangeSec;
}

export function randomJitter(rangeSec: number): number {
  return (Math.random() * 2 - 1) * rangeSec;
}

export function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
    : normalized;
}

export function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isResponseFormatUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const text = `${String(candidate.code ?? "")} ${String(candidate.message ?? "")}`;
  return (
    (status === 400 || status === 404 || status === 422) &&
    /(response.?format|json.?object|json.?mode)/i.test(text)
  );
}

export function assertUniqueParticipantNames(
  characters: readonly CharacterCard[],
  humans: readonly HumanParticipant[],
): void {
  const names = new Set<string>();
  for (const participant of [...characters, ...humans]) {
    if (names.has(participant.name)) {
      throw new Error(`World context contains duplicate participant name: ${participant.name}`);
    }
    names.add(participant.name);
  }
}

export function decisionHasMessage(decision: AgentDecision): boolean {
  if (decision.type === "perform") {
    return decision.items.some((item) => item.kind === "message" && Boolean(item.message.trim()));
  }
  return false;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function withAbortSignal(provider: ChatProvider, signal: AbortSignal): ChatProvider {
  return {
    get profile() {
      return provider.profile;
    },
    complete: (params) => {
      signal.throwIfAborted();
      return provider.complete({ ...params, signal: mergeAbortSignals(signal, params.signal) });
    },
    stream: (params) => {
      signal.throwIfAborted();
      return provider.stream({ ...params, signal: mergeAbortSignals(signal, params.signal) });
    },
    chat: (params) => {
      signal.throwIfAborted();
      return provider.chat({ ...params, signal: mergeAbortSignals(signal, params.signal) });
    },
  };
}

export function mergeAbortSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  return secondary ? AbortSignal.any([primary, secondary]) : primary;
}
