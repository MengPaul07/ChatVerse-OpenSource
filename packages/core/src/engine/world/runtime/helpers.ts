import type {
  CharacterState,
  ChatMessage,
  LoreBook,
} from "../../../contracts/chat.js";
import type {
  ActorStateSource,
  WorldActorBackgroundState,
  WorldActorControlState,
  WorldDirectorActorAuthority,
  WorldEvent,
} from "../../../contracts/world.js";
import type { ContextTimelineEntry as TimelineEntry } from "../../../context/timeline.js";
import type { WorldDirectorTask } from "../director/index.js";
import type { NarratorMode } from "../narrator/index.js";
import type {
  WorldDebugCategory,
  WorldDebugEvent,
  WorldDebugSnapshot,
} from "../../../contracts/world-debug.js";

export function ambientDelayRange(noopCount: number): readonly [number, number] {
  if (noopCount <= 0) return [15_000, 30_000];
  if (noopCount === 1) return [30_000, 60_000];
  return [60_000, 120_000];
}

export function higherNarratorMode(
  current: NarratorMode | undefined,
  next: NarratorMode,
): NarratorMode {
  const priority: Record<NarratorMode, number> = {
    check_closure: 1,
    resolve_action: 2,
    open_beat: 3,
    redirect_scene: 4,
  };
  return !current || priority[next] > priority[current] ? next : current;
}

export function compactNarratorEvent(event: WorldEvent): string {
  if (event.type === "context.message.committed") {
    return `${event.payload.message.characterName}: ${truncateText(event.payload.message.message, 160)}`;
  }
  if (event.type === "context.action.committed") {
    return `${event.payload.action.characterName}: ${truncateText(event.payload.action.action, 160)}`;
  }
  if (event.type === "narrative.narration.committed") {
    return truncateText(event.payload.narration.text, 180);
  }
  if (event.type === "world.event.emitted") {
    return truncateText(event.payload.message, 180);
  }
  return truncateText(JSON.stringify(event.payload), 180);
}

export function narratorTimelineEntry(event: WorldEvent): TimelineEntry {
  let text: string;
  if (event.type === "context.message.committed") {
    text = `【${event.payload.message.characterName}】：${event.payload.message.message}`;
  } else if (event.type === "context.action.committed") {
    text = `【${event.payload.action.characterName}（动作）】：${event.payload.action.action}`;
  } else if (event.type === "narrative.narration.committed") {
    text = `【旁白】：${event.payload.narration.text}`;
  } else if (event.type === "world.event.emitted") {
    text = `【世界事件】：${event.payload.message}`;
  } else {
    text = `【${event.type}】：${compactNarratorEvent(event)}`;
  }
  return {
    id: event.id,
    timestamp: event.occurredAt,
    order: event.sequence,
    text,
  };
}

export function isDirectorInputEvent(event: WorldEvent): boolean {
  if (
    event.causationId &&
    [
      "world.event.emitted",
      "actor.registered",
      "actor.presence.changed",
      "actor.participation.changed",
    ].includes(event.type)
  ) {
    return false;
  }
  if (event.type === "narrative.beat.completed") return event.payload.reason === "resolved";
  return [
    "world.event.emitted",
    "world.progression.requested",
    "player.directive",
  ].includes(event.type);
}

export function isImmediateDirectorInputEvent(event: WorldEvent): boolean {
  if (event.type === "narrative.beat.completed") return event.payload.reason === "resolved";
  return [
    "world.event.emitted",
    "world.progression.requested",
    "player.directive",
  ].includes(event.type);
}

export function mergeLoreBooks(world?: LoreBook, context?: LoreBook): LoreBook | undefined {
  if (!world && !context) return undefined;
  return {
    name: context?.name ?? world?.name,
    description: [world?.description, context?.description].filter(Boolean).join("\n"),
    entries: [
      ...(world?.entries ?? []),
      ...(context?.entries ?? []),
    ].map((entry) => ({
      ...entry,
      keys: [...entry.keys],
    })),
  };
}

export function cloneMessage(message: ChatMessage): ChatMessage {
  return { ...message };
}

export function memoryEventText(event: WorldEvent): string {
  if (event.type === "context.message.committed") {
    return `${event.payload.message.characterName}: ${event.payload.message.message}`;
  }
  if (event.type === "context.action.committed") {
    return `${event.payload.action.characterName}（动作）: ${event.payload.action.action}`;
  }
  if (event.type === "narrative.narration.committed") {
    return event.payload.narration.text;
  }
  if (event.type === "world.event.emitted") {
    return event.payload.message;
  }
  return JSON.stringify(event.payload);
}

export function debugCategoryForSessionEvent(type: string): WorldDebugCategory {
  if (type.includes("error")) return "error";
  if (type.startsWith("harness.")) return "harness";
  if (type.startsWith("queue.")) return "queue";
  if (type.startsWith("director.")) return "director";
  if (type.startsWith("provider.")) return "provider";
  if (type.startsWith("memory.") || type.includes("compression")) return "memory";
  if (type.includes("request") || type.includes("response") || type.includes("prompt")) {
    return "provider";
  }
  return "context";
}

export function summarizeToolCalls(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (!item || typeof item !== "object") return { name: "unknown" };
    const call = item as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    return {
      id: call.id,
      name: call.function?.name,
    };
  });
}

export function cloneDebugEvent(event: WorldDebugEvent): WorldDebugEvent {
  return {
    ...event,
    payload: JSON.parse(JSON.stringify(event.payload)) as Record<string, unknown>,
  };
}

export function cloneActorBackgroundState(
  background: WorldActorBackgroundState | undefined,
): WorldActorBackgroundState | undefined {
  return background ? {
    ...background,
    sourceEventIds: [...background.sourceEventIds],
  } : undefined;
}

export function cloneActorControlState(
  state: WorldActorControlState | undefined,
): WorldActorControlState | undefined {
  return state ? {
    ...state,
    policy: { ...state.policy },
  } : undefined;
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function sourceEventKey(values: readonly string[]): string {
  return unique(values).sort().join("|");
}

export function actorStateSource(source: CharacterState["source"]): ActorStateSource {
  return source === "character" ? "actor" : source;
}

export function authorityRank(authority: WorldDirectorActorAuthority): number {
  return authority === "manage" ? 2 : authority === "coordinate" ? 1 : 0;
}

export function minimumAuthority(
  left: WorldDirectorActorAuthority,
  right: WorldDirectorActorAuthority,
): WorldDirectorActorAuthority {
  return authorityRank(left) <= authorityRank(right) ? left : right;
}

export function normalizeBackground(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function truncateText(value: string, maxLength: number): string {
  const chars = [...value.trim()];
  return chars.length <= maxLength
    ? chars.join("")
    : `${chars.slice(0, maxLength - 1).join("")}…`;
}

export function eventRelatedChapterIds(event: WorldEvent): string[] {
  const payload = event.payload as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const ids: string[] = [];
  if (typeof record.chapterId === "string") ids.push(record.chapterId);
  for (const key of ["chapter", "beat"] as const) {
    const nested = record[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const nestedRecord = nested as Record<string, unknown>;
    const id = key === "chapter" ? nestedRecord.id : nestedRecord.chapterId;
    if (typeof id === "string") ids.push(id);
  }
  return unique(ids);
}

export function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDebugTaskState(
  task: WorldDirectorTask,
): NonNullable<WorldDebugSnapshot["director"]["task"]> {
  return {
    mode: task.mode,
    objective: task.objective,
    requiredToolNames: [...task.requiredToolNames],
    toolNames: [],
    failedToolNames: [],
    status: "running",
    retryCount: 0,
    missingToolNames: [...task.requiredToolNames],
  };
}
