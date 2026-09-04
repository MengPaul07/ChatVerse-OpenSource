import type { CharacterCard, CharacterState, ChatMessage } from "../../contracts/chat.js";
import type { DebugEvent } from "../../observability/debug/index.js";
import type { HarnessTrigger } from "../events/trigger-queue.js";
import type { GeneratingMessage, ScheduledMessage, CharacterRuntimeState } from "../queues/types.js";
import type { ActiveScene } from "../state.js";
import type { SessionState } from "../state.js";

type SessionStatus = "idle" | "running" | "paused" | "stopped";
type WakeStrength = "weak" | "normal" | "strong";

export interface SessionDebugStateInput {
  sessionId: string;
  status: SessionStatus;
  scene: Pick<ActiveScene, "state" | "topic" | "atmosphere">;
  now: number;
  characters: readonly { name: string; state?: CharacterState }[];
  characterRuntime: ReadonlyMap<string, CharacterRuntimeState>;
  messages: readonly ChatMessage[];
  scheduled: readonly ScheduledMessage[];
  generating: readonly GeneratingMessage[];
  triggers: readonly HarnessTrigger[];
  debugEvents: readonly DebugEvent[];
  isGenerating: (characterName: string) => boolean;
}

export interface SessionDebugSnapshot {
  sessionId: string;
  status: SessionStatus;
  scene: { state: string; topic: string; atmosphere: string };
  messageCount: number;
  messages: ChatMessage[];
  characters: Array<{
    name: string;
    state: CharacterState;
    runtime: {
      idleCheckAt?: number;
      idleRemainingSec?: number;
      idleRevision?: number;
      idleReason?: CharacterRuntimeState["idleReason"];
      mutedUntil?: number;
      mutedRemainingSec?: number;
      lastSpokeAt?: number;
      lastDecisionAt?: number;
      lastMentionedAt?: number;
      lastWakeAt?: number;
      lastWakeFrom?: string;
      wakeReason?: string;
      wakeStrength?: WakeStrength;
      consecutiveSilentCount?: number;
      passiveBackoffCount?: number;
    };
    recentSpeakCount: number;
    hasScheduled: boolean;
    isGenerating: boolean;
  }>;
  queues: {
    scheduled: Array<{
      id: string; speaker: string; message: string; outputKind: "message" | "action"; sendAt: number;
      remainingSec: number; overdueMs: number; nextIdleSec?: number; reason?: string;
    }>;
    generating: Array<{
      id: string; speaker: string; intent: string;
      createdAt: number; ageMs: number; status: string;
    }>;
    triggers: Array<{
      type: string; target: string; source?: string; priority: number;
      messageId?: string; message?: string; enqueuedAt?: number;
    }>;
  };
  debug: { eventCount: number; lastEventAt?: number; events: Record<string, unknown>[] };
}

export function buildSessionDebugSnapshot(input: SessionDebugStateInput): SessionDebugSnapshot {
  const characters = input.characters.map((character) => {
    const state = character.state;
    const runtime = input.characterRuntime.get(character.name);
    return {
      name: character.name,
      state: state
        ? { ...state }
        : {
            characterName: character.name,
            availability: "available" as const,
            attention: "active" as const,
            updatedAt: 0,
            source: "system" as const,
          },
      runtime: {
        idleCheckAt: runtime?.idleCheckAt,
        idleRemainingSec: runtime?.idleCheckAt
          ? Math.max(0, Math.round((runtime.idleCheckAt - input.now) / 100) / 10)
          : undefined,
        idleRevision: runtime?.idleRevision,
        idleReason: runtime?.idleReason,
        mutedUntil: runtime?.mutedUntil,
        mutedRemainingSec: runtime?.mutedUntil
          ? Math.max(0, Math.round((runtime.mutedUntil - input.now) / 100) / 10)
          : undefined,
        lastSpokeAt: runtime?.lastSpokeAt,
        lastDecisionAt: runtime?.lastDecisionAt,
        lastMentionedAt: runtime?.lastMentionedAt,
        lastWakeAt: runtime?.lastWakeAt,
        lastWakeFrom: runtime?.lastWakeFrom,
        wakeReason: runtime?.wakeReason,
        wakeStrength: runtime?.wakeStrength,
        consecutiveSilentCount: runtime?.consecutiveSilentCount,
        passiveBackoffCount: runtime?.passiveBackoffCount,
      },
      recentSpeakCount: input.messages.slice(-5).filter((message) => message.characterName === character.name).length,
      hasScheduled: input.scheduled.some((message) => message.speaker === character.name),
      isGenerating: input.isGenerating(character.name),
    };
  });

  const debugEvents = input.debugEvents.slice(-300).map((event) => ({ ...event }));

  return {
    sessionId: input.sessionId,
    status: input.status,
    scene: {
      state: input.scene.state,
      topic: input.scene.topic,
      atmosphere: input.scene.atmosphere,
    },
    messageCount: input.messages.length,
    messages: input.messages.slice(-40).map((message) => ({ ...message })),
    characters,
    queues: {
      scheduled: input.scheduled.map((scheduled) => ({
        id: scheduled.id,
        speaker: scheduled.speaker,
        message: scheduled.message,
        outputKind: scheduled.outputKind,
        sendAt: scheduled.sendAt,
        remainingSec: Math.max(0, Math.round((scheduled.sendAt - input.now) / 100) / 10),
        overdueMs: Math.max(0, input.now - scheduled.sendAt),
        nextIdleSec: scheduled.nextIdleSec,
        reason: scheduled.reason,
      })),
      generating: input.generating.map((generating) => ({
        id: generating.id,
        speaker: generating.speaker,
        intent: generating.intent,
        createdAt: generating.createdAt,
        ageMs: Math.max(0, input.now - generating.createdAt),
        status: generating.status,
      })),
      triggers: input.triggers.map((trigger) => ({ ...trigger })),
    },
    debug: {
      eventCount: input.debugEvents.length,
      lastEventAt: input.debugEvents[input.debugEvents.length - 1]?.timestamp,
      events: debugEvents,
    },
  };
}

export function buildSessionDebugSnapshotFromState(input: {
  sessionId: string;
  status: SessionStatus;
  state: SessionState;
  now: number;
  characters: readonly CharacterCard[];
  getCharacterState(characterName: string): CharacterState | undefined;
  characterRuntime: ReadonlyMap<string, CharacterRuntimeState>;
  scheduled: readonly ScheduledMessage[];
  generating: readonly GeneratingMessage[];
  triggers: readonly HarnessTrigger[];
  debugEvents: readonly DebugEvent[];
  isGenerating(characterName: string): boolean;
}): SessionDebugSnapshot {
  return buildSessionDebugSnapshot({
    sessionId: input.sessionId,
    status: input.status,
    scene: input.state.scene,
    now: input.now,
    characters: input.characters.map((character) => ({
      name: character.name,
      state: input.getCharacterState(character.name),
    })),
    characterRuntime: input.characterRuntime,
    messages: input.state.messages,
    scheduled: input.scheduled,
    generating: input.generating,
    triggers: input.triggers,
    debugEvents: input.debugEvents,
    isGenerating: input.isGenerating,
  });
}
