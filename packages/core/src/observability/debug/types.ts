import type { ChatMessage } from "../../contracts/chat.js";
import type {
  ProviderRequestContext,
  ProviderUsageOperation,
  ProviderUsageRole,
  TokenUsage,
} from "../../contracts/provider.js";
import type { HumanMessageInput } from "../../engine/input/types.js";

export type { DebugConfig } from "../../contracts/debug.js";

export type DebugEventListener = (event: DebugEvent) => void;
export type DebugUnsubscribe = () => void;

interface DebugEventBase<TType extends string> {
  id: string;
  type: TType;
  sessionId: string;
  turnId?: string;
  timestamp: number;
}

export interface ExternalMessageInjectedEvent
  extends DebugEventBase<"message.injected"> {
  message: ChatMessage;
}

export interface InboxMessageEnqueuedEvent
  extends DebugEventBase<"inbox.message_enqueued"> {
  message: HumanMessageInput;
  queueLength: number;
}

export interface CharacterPromptBuiltEvent
  extends DebugEventBase<"character.prompt_built"> {
  characterName: string;
  historyCount: number;
  systemPrompt?: string;
  userPrompt?: string;
}

export interface CharacterRequestStartedEvent
  extends DebugEventBase<"character.request_started"> {
  characterName: string;
}

export interface CharacterResponseCompletedEvent
  extends DebugEventBase<"character.response_completed"> {
  characterName: string;
  message?: string;
  elapsedMs?: number;
}

export interface CharacterStateUpdatedEvent extends DebugEventBase<"character_state.updated"> {
  characterName: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  source: string;
  reason?: string;
}

export interface QueueMessageScheduledEvent extends DebugEventBase<"queue.message_scheduled"> {
  messageId: string;
  speaker: string;
  plannedDelayMs?: number;
  remainingDelayMs?: number;
  lateByMs?: number;
  delayMs: number;
  sendAt?: number;
  /** Harness typing delay details */
  charCount?: number;
  hesitationSec?: number;
  nextIdleSec?: number;
  nextIdleSource?: "runtime" | "runtime_with_model_hint";
  burstIndex?: number;
  burstCount?: number;
}

export interface QueueMessageSentEvent extends DebugEventBase<"queue.message_sent"> {
  messageId: string;
  speaker: string;
  outputKind: "message" | "action";
}

export interface QueueMessageDroppedEvent extends DebugEventBase<"queue.message_dropped"> {
  messageId: string;
  speaker: string;
  reason?: string;
}

export interface HarnessSchedulerWaitEvent extends DebugEventBase<"harness.scheduler_wait"> {
  waitMs: number;
  reason: string;
}

export interface HarnessIdleScheduledEvent extends DebugEventBase<"harness.idle_scheduled"> {
  characterName: string;
  nextIdleSec: number;
  reason: "speak_sent" | "silent" | "passive_backoff" | "cancelled" | "opening" | "response" | "ambient" | "silent_retry" | "world_output_complete";
  detail?: string;
}

export interface HarnessTriggerEnqueuedEvent extends DebugEventBase<"harness.trigger_enqueued"> {
  triggerType: "mention" | "event" | "idle" | "wake";
  target: string;
  source?: string;
  priority: number;
}

export interface HarnessTriggerProcessingEvent extends DebugEventBase<"harness.trigger_processing"> {
  triggerType: "mention" | "event" | "idle" | "wake";
  target: string;
  source?: string;
  priority: number;
}

export interface HarnessTriggerSkippedEvent extends DebugEventBase<"harness.trigger_skipped"> {
  triggerType: "mention" | "event" | "idle" | "wake";
  target: string;
  reason: string;
}

export interface HarnessDecisionEvent extends DebugEventBase<"harness.decision"> {
  characterName: string;
  triggerType: string;
  decision: "speak" | "silent";
  reason?: string;
}

export interface HarnessWakeSignalEvent extends DebugEventBase<"harness.wake_signal"> {
  source: string;
  target: string;
  strength: "weak" | "normal" | "strong";
  reason?: string;
  applied: boolean;
  nextIdleSec?: number;
  skippedReason?: string;
}

export interface ContextPackedEvent extends DebugEventBase<"context.packed"> {
  target: "director" | "character" | "queue_planner";
  estimatedTokens: number;
  included: string[];
  dropped: string[];
  truncated: string[];
}

export interface ContextCompressionStartedEvent extends DebugEventBase<"context.compression_started"> {
  sourceTokens: number;
  messageCount: number;
  throughMessageId: string;
}

export interface ContextCompressionCompletedEvent extends DebugEventBase<"context.compression_completed"> {
  sourceTokens: number;
  messageCount: number;
  throughMessageId: string;
  summaryTokens: number;
  factCount: number;
}

export interface ContextCompressionFailedEvent extends DebugEventBase<"context.compression_failed"> {
  sourceTokens: number;
  messageCount: number;
  message: string;
  retryAfterMs: number;
}

export interface ActorWakeEnqueuedEvent extends DebugEventBase<"actor.wake_enqueued"> {
  characterName: string;
  source: "narrator" | "player_focus" | "player_direct";
  reason: string;
  result: "enqueued";
  priority: number;
  messageId?: string;
  chainId?: string;
}

export interface ActorWakeSkippedEvent extends DebugEventBase<"actor.wake_skipped"> {
  characterName: string;
  source: "narrator" | "player_focus" | "player_direct";
  reason: string;
  result?: "duplicate" | "target_busy";
  priority?: number;
  messageId?: string;
  chainId?: string;
}

export interface ActorWakeSettledEvent extends DebugEventBase<"actor.wake_settled"> {
  characterName: string;
  source: "narrator" | "player_focus" | "player_direct";
  outcome: "output_scheduled" | "silent" | "failed" | "cancelled";
  failure?: string;
  messageId?: string;
  chainId?: string;
}

export interface ProviderUsageEvent extends DebugEventBase<"provider.usage"> {
  providerRole: ProviderUsageRole;
  operation: ProviderUsageOperation;
  requestContext?: ProviderRequestContext;
  usage: TokenUsage;
}

export interface AgentErrorEvent extends DebugEventBase<"agent.error"> {
  agent: "character" | "session";
  message: string;
}

export type DebugEvent =
  | ExternalMessageInjectedEvent
  | InboxMessageEnqueuedEvent
  | CharacterPromptBuiltEvent
  | CharacterRequestStartedEvent
  | CharacterResponseCompletedEvent
  | CharacterStateUpdatedEvent
  | QueueMessageScheduledEvent
  | QueueMessageSentEvent
  | QueueMessageDroppedEvent
  | HarnessSchedulerWaitEvent
  | HarnessIdleScheduledEvent
  | HarnessTriggerEnqueuedEvent
  | HarnessTriggerProcessingEvent
  | HarnessTriggerSkippedEvent
  | HarnessDecisionEvent
  | HarnessWakeSignalEvent
  | ActorWakeEnqueuedEvent
  | ActorWakeSkippedEvent
  | ActorWakeSettledEvent
  | ContextPackedEvent
  | ContextCompressionStartedEvent
  | ContextCompressionCompletedEvent
  | ContextCompressionFailedEvent
  | ProviderUsageEvent
  | AgentErrorEvent;

export type DebugEventInput = DebugEvent extends infer TEvent
  ? TEvent extends DebugEvent
    ? Omit<TEvent, "id" | "sessionId" | "timestamp">
    : never
  : never;
