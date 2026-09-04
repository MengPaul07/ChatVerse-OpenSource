import type { CharacterStatePatch } from "./actor-state.js";

export interface ScheduledMessage {
  id: string;
  speaker: string;
  message: string;
  outputKind: "message" | "action";
  contextTransition?: "leave";
  sendAt: number;
  createdAt: number;
  reason?: string;
  statePatch?: CharacterStatePatch;
  nextIdleSec?: number;
}
