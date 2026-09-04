import {
  ChatVerse,
  type ChatMessage,
  type WorldEvent,
  type WorldSourceProvider,
} from "@chatverse/core";
import {
  compileWorldDraft,
  type WorldDraft,
} from "@chatverse/world-authoring";
import type { ProviderPair } from "../rooms/contracts.js";
import { numberValue, record, stringValue } from "./helpers.js";

const PREVIEW_TIMEOUT_MS = 30_000;
const PREVIEW_SETTLE_AFTER_OUTPUT_MS = 3_000;
const PREVIEW_ACTOR_OUTPUT_LIMIT = 4;

export interface AuthoringPreviewEntry {
  id: string;
  kind: "narration" | "character" | "action";
  actorId?: string;
  actorName?: string;
  text: string;
  occurredAt: number;
  contextId?: string;
}

export interface AuthoringPreviewResult {
  entries: AuthoringPreviewEntry[];
  beatCount: number;
  warnings: string[];
  timedOut: boolean;
}

export async function runPreview(input: {
  draft: WorldDraft;
  providers: ProviderPair;
  playerMessage?: string;
  sourceProvider?: WorldSourceProvider;
  signal: AbortSignal;
}): Promise<AuthoringPreviewResult> {
  const definition = compileWorldDraft(input.draft, { now: Date.now() });
  const previewDefinition = {
    ...definition,
    contexts: definition.contexts.map((context) => ({
      ...context,
      runtime: {
        ...context.runtime,
        pacingMultiplier: 0.05,
        contextCompression: {
          ...context.runtime?.contextCompression,
          historyTokenThreshold: 0,
        },
        actorRuntime: {
          ...context.runtime?.actorRuntime,
          ambient: "off" as const,
        },
      },
    })),
    actorMemoryPolicy: { enabled: false },
  };
  const world = new ChatVerse({
    directorProvider: input.providers.directorProvider,
    characterProvider: input.providers.characterProvider,
  }).createWorld(previewDefinition, {
    debug: false,
    sourceProvider: input.sourceProvider,
  });
  const actorNameById = new Map(previewDefinition.actors.map((actor) => [
    actor.id,
    actor.card.name,
  ]));
  const entries: AuthoringPreviewEntry[] = [];
  let beatCount = 0;
  let actorOutputs = 0;
  let narrationCount = 0;
  let settle: (() => void) | undefined;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const completed = new Promise<void>((resolve) => { settle = resolve; });
  const scheduleQuietSettle = () => {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => settle?.(), PREVIEW_SETTLE_AFTER_OUTPUT_MS);
  };
  const unsubscribe = world.onEvent((event) => {
    const entry = previewEntry(event, actorNameById);
    if (entry) {
      entries.push(entry);
      if (entry.kind === "narration") narrationCount++;
      else actorOutputs++;
      scheduleQuietSettle();
    }
    if (event.type === "narrative.beat.recorded") beatCount++;
    if (actorOutputs >= PREVIEW_ACTOR_OUTPUT_LIMIT || (
      narrationCount >= 1 && actorOutputs >= 2
    )) settle?.();
  });
  const timer = setTimeout(() => {
    timedOut = true;
    settle?.();
  }, PREVIEW_TIMEOUT_MS);
  const onAbort = () => settle?.();
  input.signal.addEventListener("abort", onAbort, { once: true });

  try {
    world.start();
    const contextId = previewDefinition.contexts[0]!.id;
    if (previewDefinition.directorPolicy?.enabled !== false) {
      world.requestProgression({ contextId, reason: "bootstrap" });
    }
    const player = previewDefinition.actors.find((actor) => (
      actor.playerControlled === true
    ));
    if (input.playerMessage?.trim() && player) {
      world.sendMessage({
        contextId,
        actorId: player.id,
        message: input.playerMessage.trim(),
      });
    }
    await completed;
  } finally {
    clearTimeout(timer);
    if (quietTimer) clearTimeout(quietTimer);
    input.signal.removeEventListener("abort", onAbort);
    unsubscribe();
    world.stop();
  }

  return {
    entries,
    beatCount,
    warnings: entries.length
      ? []
      : ["预演期间没有产生可见输出，请检查 Director、角色背景或 Provider。"],
    timedOut,
  };
}

function previewEntry(
  event: WorldEvent,
  actorNameById: ReadonlyMap<string, string>,
): AuthoringPreviewEntry | undefined {
  if (event.type === "narrative.narration.committed") {
    const narration = record(event.payload.narration);
    const text = stringValue(narration?.text);
    if (!text) return undefined;
    return {
      id: event.id,
      kind: "narration",
      text,
      occurredAt: numberValue(narration?.occurredAt) ?? event.occurredAt,
      contextId: event.contextId,
    };
  }
  if (event.type === "context.message.committed") {
    const message = record(event.payload.message) as Partial<ChatMessage> | undefined;
    if (!message?.message || message.source !== "character") return undefined;
    return {
      id: event.id,
      kind: "character",
      actorId: event.actorId,
      actorName: event.actorId ? actorNameById.get(event.actorId) : message.characterName,
      text: message.message,
      occurredAt: message.timestamp ?? event.occurredAt,
      contextId: event.contextId,
    };
  }
  if (event.type === "context.action.committed") {
    const action = record(event.payload.action);
    const text = stringValue(action?.action);
    if (!text) return undefined;
    return {
      id: event.id,
      kind: "action",
      actorId: event.actorId,
      actorName: event.actorId ? actorNameById.get(event.actorId) : undefined,
      text,
      occurredAt: numberValue(action?.timestamp) ?? event.occurredAt,
      contextId: event.contextId,
    };
  }
  return undefined;
}
