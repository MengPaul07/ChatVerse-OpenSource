export type WorldForegroundOperation = "director" | "narrator" | "actor" | "player";

export type WorldForegroundResponsibility =
  | "open_beat"
  | "transition_beat"
  | "arbitrate_turn"
  | "perform_turn"
  | "prepare_player_turn";

export type WorldForegroundFailureKind =
  | "stalled"
  | "timeout"
  | "provider"
  | "protocol"
  | "task_incomplete";

export interface WorldForegroundFailure {
  id: string;
  kind: WorldForegroundFailureKind;
  message: string;
  userMessage: string;
  retryable: boolean;
  occurredAt: number;
}

/** Player-visible recovery state for the one foreground responsibility owned by a Context. */
export interface WorldForegroundRecoveryState {
  id: string;
  contextId: string;
  operation: WorldForegroundOperation;
  responsibility: WorldForegroundResponsibility;
  status: "expected" | "running" | "retry_scheduled" | "failed";
  attempt: number;
  maxAutomaticRetries: number;
  expectedAt: number;
  lastProgressAt: number;
  retryAt?: number;
  beatId?: string;
  actorId?: string;
  failure?: WorldForegroundFailure;
}
