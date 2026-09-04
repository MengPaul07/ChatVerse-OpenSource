import type { NarrativeNarration } from "./narrative.js";

export interface ContextActivityState {
  revision: number;
  focusActorIds: string[];
  lastCommittedAt: number;
  ambientNoopCount: number;
  nextAmbientAt?: number;
}

export interface WorldContextState {
  contextId: string;
  status: WorldContextStatus;
  /** Why this context is paused. Omitted while it is not paused. */
  pauseReason?: WorldContextPauseReason;
  /** Latest committed narration node, beginning with the authored SceneCard. */
  scene: NarrativeNarration;
  activity?: ContextActivityState;
  updatedAt: number;
}

export type WorldContextStatus = "dormant" | "active" | "paused" | "stopped";
export type WorldContextPauseReason = "manual" | "unread" | "unobserved";

export type PresentationParticipant =
  | { type: "narration" }
  | { type: "actor"; actorId: string }
  | { type: "player"; actorId: string };

export interface PlayerPerformance {
  message?: string;
  action?: string;
}

export interface PlayerPerformanceOption {
  label: string;
  performance: PlayerPerformance;
}

export interface PlayerTurnProposal {
  id: string;
  contextId: string;
  beatId: string;
  prompt?: string;
  guidance?: string;
  suggestions: PlayerPerformanceOption[];
  autoPerformance: PlayerPerformanceOption;
}

export interface PresentationTurnState {
  turnToken: string;
  contextId: string;
  beatId: string;
  participant: PresentationParticipant;
  entryIds: string[];
  status: "waiting_ack" | "waiting_player";
  /**
   * Absolute runtime timestamp before which the visible turn cannot advance.
   * Only the opening narration of a new Beat uses this gate.
   */
  acknowledgeAfter?: number;
}

export type PresentationAcknowledgementResult = "accepted" | "stale" | "too_early";

export interface PresentationRuntimeSnapshot {
  contextId: string;
  beatId: string;
  mode: "world" | "stage";
  prefetchLimit: number;
  normalPacingMultiplier?: number;
  status: "idle" | "generating" | "waiting_ack" | "waiting_player" | "error";
  current?: PresentationTurnState;
  buffered: PresentationTurnState[];
  playerProposal?: PlayerTurnProposal;
  openingNarrationPending: boolean;
  lastAcknowledgedTurnToken?: string;
  error?: string;
}
