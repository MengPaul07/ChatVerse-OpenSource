import type {
  ActorAction,
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
} from "../../contracts/chat.js";
import type { ActorMemorySlice } from "../../contracts/actor-memory.js";
import type { NarrativeNarration } from "../../contracts/world.js";
import type { ProviderFailureDetails } from "../provider-failure.js";

export type ActorWakeSource = "narrator" | "player_focus" | "player_direct";

export interface ActorWakeRequest {
  characterName: string;
  source: ActorWakeSource;
  reason: string;
  messageId?: string;
  requiresReply: boolean;
  priority: number;
  chainId?: string;
}

export interface ActorWakeSettlement {
  characterName: string;
  source: ActorWakeSource;
  outcome: "output_scheduled" | "silent" | "failed" | "cancelled";
  messageId?: string;
  chainId?: string;
  failure?: "provider" | "parse" | "invalid_target" | "unavailable";
}

export interface WorldSessionBinding {
  readonly contextId: string;
  /**
   * Autonomous contexts own Actor idle timers. Orchestrated World contexts
   * only execute explicit Narrator/player wakes and never create cooldown or
   * background polling work inside Session.
  */
  readonly actorScheduling: "autonomous_idle" | "external_wake";
  readonly getActorMaxTokens?: () => number | undefined;
  actorIdForCharacter(characterName: string): string | undefined;
  readActorState(actorId: string): Pick<
    CharacterState,
    "availability" | "attention" | "mood" | "intent" | "note" | "updatedAt"
  > | undefined;
  readActorRevision(actorId: string): number | undefined;
  readActorBackground(actorId: string): string | undefined;
  applyActorStatePatch(
    actorId: string,
    patch: CharacterStatePatch,
    source: CharacterState["source"],
  ): void;
  commitActorAction(action: ActorAction): void;
  /** 增量时间线块(共享前缀);未启用增量化时返回 undefined。 */
  readonly getWorldTimelineBlock?: (actorId: string) => string;
  projectActorHistory(
    actorId: string,
    messages: readonly ChatMessage[],
    actions: readonly ActorAction[],
  ): {
    messages: readonly ChatMessage[];
    actions: readonly ActorAction[];
    includeDigest: boolean;
  };
  recallActorMemory(actorId: string, messages: readonly ChatMessage[]): ActorMemorySlice | undefined;
  readCurrentScene(): NarrativeNarration | undefined;
  acquireGeneration(actorId: string, priority: number, signal?: AbortSignal): Promise<() => void>;
  onProviderError?(error: ProviderFailureDetails): boolean;
  onActorWakeStarted?(request: ActorWakeRequest): void;
  onActorWakeSettled(settlement: ActorWakeSettlement): void;
  onActorOutputDrained(characterName: string, producedOutput?: boolean): void;
}
