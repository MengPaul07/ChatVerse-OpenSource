import type { ContextCompressionConfig, LoreBook, SceneCard, SessionMessageStyleConfig } from "../chat.js";
import type {
  WorldActorDefinition,
  WorldDirectorActorAuthority,
  WorldRelation,
} from "./actors.js";
import type { NarrativeChapter } from "./narrative.js";
import type { WorldSourceBinding } from "./source.js";

export interface WorldMetadata {
  id: string;
  name: string;
  description?: string;
  version?: string;
}

export interface WorldActorRuntimePolicy {
  activation?: "beat_runtime" | "autonomous_idle";
  playerRouting?: "focus_actor" | "narrator";
  ambient?: "off" | "low";
}

export interface ResolvedWorldActorRuntimePolicy {
  activation: "beat_runtime" | "autonomous_idle";
  playerRouting: "focus_actor" | "narrator";
  ambient: "off" | "low";
}

export interface WorldChatRuntimeConfig {
  /** Scales all visible and background Actor timing. Larger values are slower. */
  pacingMultiplier?: number;
  interventionCommitWindowMs?: number;
  forceSpeakAfterConsecutiveSilents?: boolean;
  messageStyle?: SessionMessageStyleConfig;
  contextCompression?: Partial<ContextCompressionConfig>;
  actorRuntime?: WorldActorRuntimePolicy;
  /** Selects the isolated executor used while a Director-planned Beat is active. */
  beatRuntime?: WorldBeatRuntimeConfig;
}

export interface WorldBeatRuntimeConfig {
  /** Output budget for the single Narrator arbitration call. */
  narratorMaxTokens?: number;
  /** Output budget for one Actor turn. */
  actorMaxTokens?: number;
  /** Output budget for one Player option proposal. */
  playerMaxTokens?: number;
  /** Technical retries for one selected participant. */
  maxAttemptsPerTurn?: number;
  retryBackoffMs?: number[];
  /** Maximum generated turns kept ahead of the visible stage turn. Defaults to 5. */
  presentationPrefetchLimit?: number;
}

export interface WorldContextDefinition {
  id: string;
  kind: "chat";
  /** A private Context keeps its own history while reusing World Actor state. */
  conversationMode?: "group" | "private";
  name: string;
  actorIds: string[];
  scene: SceneCard;
  /**
   * Author-facing context lore for the World Director.
   * Actors only learn these facts after they enter narration/events/history,
   * or when the same knowledge exists in their own card, lore, or memory.
   */
  lore?: LoreBook;
  runtime?: WorldChatRuntimeConfig;
  presentation?: GalgamePresentationConfig;
  initiallyActive?: boolean;
}

export interface GalgamePresentationConfig {
  kind: "galgame";
  playerActorId: string;
  artDirection: string;
  backgroundGeneration: "auto";
  acknowledgement: "required";
  /** Defaults to 10 seconds; useful for deterministic hosts and previews. */
  openingNarrationMinimumDisplayMs?: number;
}

export interface WorldDirectorPolicy {
  enabled?: boolean;
  /** Whether the Director may use provider-side hidden reasoning. */
  reasoning?: boolean;
  /** Number of low-priority WorldEvents to collect before a Director pass. */
  batchSize?: number;
  /** Delay used when a low-priority batch becomes ready. Important events bypass it. */
  debounceMs?: number;
  /** Minimum interval between Director passes, except for immediate wake-ups. */
  minIntervalMs?: number;
  maxBatchSize?: number;
  maxToolRounds?: number;
  /** Delay before Narrator resolves a committed Actor action or checks Beat closure. */
  narratorDebounceMs?: number;
  /** Provider retries allowed for one Director event batch. Default: 2. */
  maxProviderRetries?: number;
  contextSuspendAfterMs?: number;
  /** Minimum committed WorldEvent distance between background rewrites for one Actor. */
  actorBackgroundMinEvents?: number;
  actorAuthority?: WorldDirectorActorAuthority;
}

export interface WorldActorMemoryPolicy {
  enabled?: boolean;
  /** Background extraction starts after the observed conversation remains quiet this long. */
  idleExtractionMs?: number;
  /** Explicit narrative boundaries and targeted world events use this shorter delay. */
  boundaryDebounceMs?: number;
  /** Maximum evidence events supplied for one Actor at one extraction boundary. */
  maxEvidenceEvents?: number;
  /** Per-Actor operation limit within one shared pass. */
  maxOperationsPerUpdate?: number;
  /** Per-Actor create limit within one shared pass. */
  maxCreatedNotesPerUpdate?: number;
  /** Maximum active semantic notes kept in the Actor's normal recall layer. */
  maxNotesPerActor?: number;
  /** Additional cold-note budget for superseded and archived history. */
  maxArchivedNotesPerActor?: number;
  checkpointOnContextSuspend?: boolean;
}

export interface ResolvedWorldActorMemoryPolicy {
  enabled: boolean;
  idleExtractionMs: number;
  boundaryDebounceMs: number;
  maxEvidenceEvents: number;
  maxOperationsPerUpdate: number;
  maxCreatedNotesPerUpdate: number;
  maxNotesPerActor: number;
  maxArchivedNotesPerActor: number;
  checkpointOnContextSuspend: boolean;
}

export interface ResolvedWorldDirectorPolicy {
  enabled: boolean;
  reasoning: boolean;
  batchSize: number;
  debounceMs: number;
  minIntervalMs: number;
  maxBatchSize: number;
  maxToolRounds: number;
  narratorDebounceMs: number;
  maxProviderRetries: number;
  contextSuspendAfterMs: number;
  actorBackgroundMinEvents: number;
  actorAuthority: WorldDirectorActorAuthority;
}

export interface WorldDefinition {
  metadata: WorldMetadata;
  /**
   * Omniscient authoring lore for the World Director, not a shared Actor prompt.
   * Put an Actor's prior knowledge in its CharacterCard, private loreBook, or
   * role background instead.
   */
  lore?: LoreBook;
  /** Immutable large-source revisions available only to the World Director. */
  sources?: WorldSourceBinding[];
  actors: WorldActorDefinition[];
  contexts: WorldContextDefinition[];
  relations?: WorldRelation[];
  chapters?: NarrativeChapter[];
  directorPolicy?: WorldDirectorPolicy;
  actorMemoryPolicy?: WorldActorMemoryPolicy;
}
