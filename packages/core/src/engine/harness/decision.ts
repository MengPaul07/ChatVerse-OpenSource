import type { CharacterStatePatch } from "../../contracts/chat.js";

export interface AgentWake {
  target: string;
  strength?: "weak" | "normal" | "strong";
  reason?: string;
}

interface AgentDecisionBase {
  reason?: string;
  idleCooldownSec?: number;
  statePatch?: CharacterStatePatch;
}

export type ActorTurnItem =
  | { kind: "message"; message: string }
  | { kind: "action"; action: string; contextTransition?: "leave" };

/**
 * A character's complete decision for one evaluation. Schedulers decide when to
 * request it; they do not need to understand the provider's response shape.
 */
export type AgentDecision =
  | (AgentDecisionBase & {
      type: "perform";
      items: ActorTurnItem[];
      hesitationSec?: number;
    })
  | (AgentDecisionBase & {
      type: "silent";
      wake?: AgentWake;
    });

/** Parse and validate the JSON response expected from a Harness character. */
export function parseAgentDecisionJson(raw: string): AgentDecision {
  const value = parseJsonObject(raw);
  const type = value.type;
  const statePatch = normalizeStatePatch(value.statePatch);
  const reason = optionalString(value.reason);
  const idleCooldownSec = optionalFiniteNumber(value.idleCooldownSec);

  if (type === "perform") {
    const items = normalizeTurnItems(value.items);
    if (items.length === 0) {
      throw new Error("perform decision requires at least one valid item");
    }
    return {
      type: "perform",
      items,
      hesitationSec: optionalBoundedNumber(value.hesitationSec, 0, 300),
      idleCooldownSec,
      statePatch,
      reason,
    };
  }

  if (type === "silent") {
    return {
      type: "silent",
      idleCooldownSec,
      statePatch,
      reason,
      wake: normalizeWake(value.wake),
    };
  }

  throw new Error("decision type must be perform or silent");
}

export function normalizeTurnItems(value: unknown): ActorTurnItem[] {
  if (!Array.isArray(value)) return [];
  const items: ActorTurnItem[] = [];
  const seenMessages = new Set<string>();
  let messageCount = 0;
  let actionCount = 0;

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    if (item.kind === "message" && typeof item.message === "string" && messageCount < 3) {
      const message = item.message.trim();
      if (!message || seenMessages.has(message)) continue;
      seenMessages.add(message);
      items.push({ kind: "message", message });
      messageCount++;
    } else if (item.kind === "action" && typeof item.action === "string" && actionCount < 2) {
      const action = item.action.trim();
      if (!action) continue;
      items.push({
        kind: "action",
        action,
        contextTransition: item.contextTransition === "leave" ? "leave" : undefined,
      });
      actionCount++;
    }
    if (items.length >= 4) break;
  }
  return items.map((item, index) => (
    item.kind === "action" &&
    item.contextTransition === "leave" &&
    index !== items.length - 1
      ? { kind: "action", action: item.action }
      : item
  ));
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    (() => {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      return start >= 0 && end > start ? trimmed.slice(start, end + 1) : undefined;
    })(),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try recovery forms before rejecting the response.
    }
  }
  throw new Error("decision response was not a valid JSON object");
}

function normalizeStatePatch(value: unknown): CharacterStatePatch | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const patch: CharacterStatePatch = {};
  if (raw.presence === "online") {
    patch.availability = "available";
  } else if (raw.presence === "away") {
    patch.availability = "away";
  } else if (raw.presence === "offline") {
    patch.availability = "unavailable";
  }
  if (typeof raw.status === "string") {
    const status = raw.status.trim();
    patch.note = !status || status === "none" ? "" : status;
  }
  return Object.keys(patch).length ? patch : undefined;
}

function normalizeWake(value: unknown): AgentWake | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.target !== "string" || !raw.target.trim()) return undefined;
  const strength = raw.strength === "weak" || raw.strength === "normal" || raw.strength === "strong"
    ? raw.strength
    : undefined;
  return { target: raw.target.trim(), strength, reason: optionalString(raw.reason) };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return optionalBoundedNumber(value, 0, 86_400);
}

function optionalBoundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : undefined;
}
