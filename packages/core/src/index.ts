// ══════════════════════════════════════════
// @chatverse/core — 稳定公开 API
// ══════════════════════════════════════════

// ── Engine ──
export { ChatVerse } from "./engine/chatverse.js";
export { World } from "./engine/world/index.js";
export type { WorldStatus } from "./engine/world/index.js";

// ── Runtime host ──
export {
  InMemoryRuntimeNotificationBus,
  InProcessRuntimeHost,
  ManualRuntimeHost,
} from "./runtime/index.js";
export type {
  RuntimeClock,
  RuntimeHost,
  RuntimeIdGenerator,
  RuntimeNotification,
  RuntimeNotificationBus,
  RuntimeNotificationListener,
  RuntimeNotificationType,
  RuntimeScheduler,
  RuntimeTask,
  RuntimeUnsubscribe,
} from "./runtime/index.js";

// ── Provider ──
export {
  createAnthropicMessagesProvider,
  createFallbackModelProfile,
  getBuiltInModelProfile,
  createOpenAIChatProvider,
  createOpenAIResponsesProvider,
  createOpenAIResponsesResearchProvider,
  createTavilyResearchProvider,
  createWebResearchProvider,
  createZhipuResearchProvider,
  isWebResearchProtocol,
  isProviderProtocol,
  normalizeProviderError,
  ProviderRequestError,
  publicProviderErrorMessage,
  PROVIDER_PROTOCOLS,
  WEB_RESEARCH_PROTOCOLS,
  resolveModelProfile,
} from "./adapters/providers/index.js";
export type {
  AnthropicMessagesProviderConfig,
  ChatProvider,
  ChatResponse,
  LLMMessage,
  OpenAIChatProviderConfig,
  ProviderCapabilities,
  ProviderCompatibility,
  ProviderModelProfile,
  ProviderJsonCapability,
  ProviderProfile,
  ProviderProtocol,
  ProviderReasoningCapability,
  ProviderThinkingFormat,
  ProviderThinkingLevel,
  ProviderErrorCode,
  ProviderRequestContext,
  TokenUsage,
  TokenUsageListener,
  ToolCall,
  ToolDefinition,
  WebResearchProvider,
  WebResearchProviderConfig,
  WebResearchProfile,
  WebResearchProtocol,
  WebResearchResult,
  WebResearchSource,
} from "./adapters/providers/index.js";
export type {
  ProviderUsageEvent,
  ProviderUsageEventListener,
  ProviderUsageObservation,
  ProviderUsageOperation,
  ProviderUsageRole,
} from "./contracts/provider.js";

// ── Core types ──
export type {
  ActorAction,
  ActorVisualProfile,
  CharacterCard,
  CharacterState,
  CharacterStatePatch,
  ChatMessage,
  ChatVerseConfig,
  ContextCompressionConfig,
  LoreBook,
  LoreBookEntry,
  Relation,
  SceneCard,
} from "./contracts/chat.js";

export type {
  ActorMemoryCandidate,
  ActorMemoryCommit,
  ActorMemoryDefinition,
  ActorMemoryDocument,
  ActorMemoryEdge,
  ActorMemoryEdgeType,
  ActorMemoryLinkCandidate,
  ActorMemoryNode,
  ActorMemoryNodeKind,
  ActorMemoryNodeStatus,
  ActorMemoryOperation,
  ActorMemoryPatch,
  ActorMemoryRecall,
  ActorMemoryRecallQuery,
  ActorMemoryRevision,
  ActorMemoryRuntimeSnapshot,
  ActorMemorySlice,
  ActorMemorySnapshot,
  ActorMemoryStore,
} from "./contracts/actor-memory.js";

export type {
  ActorPresence,
  ActorStateSource,
  ContextParticipation,
  ContextActivityState,
  ContextContinuity,
  ContextPresenceState,
  CreateWorldOptions,
  GalgamePresentationConfig,
  PlayerCharacterCard,
  PlayerPerformance,
  PlayerPerformanceOption,
  PlayerTurnProposal,
  PresentationTurnState,
  PresentationParticipant,
  PresentationRuntimeSnapshot,
  PresentationAcknowledgementResult,
  WorldCreateChatContextInput,
  NarrativeBeat,
  NarrativeBeatSourceBasis,
  NarrativeEdge,
  NarrativeEdgeType,
  NarrativeNarration,
  NarrativeChapter,
  ResolvedWorldDirectorPolicy,
  ResolvedWorldActorMemoryPolicy,
  ResolvedWorldActorRuntimePolicy,
  ResolvedWorldActorControlPolicy,
  WorldActorDefinition,
  WorldActorControlPolicy,
  WorldActorControlState,
  WorldActorBackgroundState,
  WorldActorState,
  WorldArchive,
  WorldArchiveMetadata,
  WorldArchiveRuntimeStatus,
  WorldAiActorDefinition,
  WorldActorMemoryPolicy,
  WorldActorRuntimePolicy,
  WorldChatRuntimeConfig,
  WorldBeatRuntimeConfig,
  WorldContextDefinition,
  WorldContextState,
  WorldContextStatus,
  WorldDefinition,
  WorldSourceAdherence,
  WorldSourceBinding,
  WorldSourceCatalogItem,
  WorldSourceChunkView,
  WorldSourceFidelity,
  WorldSourceOutlineItem,
  WorldSourceProvider,
  WorldSourceSearchHit,
  WorldDirectorPolicy,
  WorldDirectorActorAuthority,
  WorldEvent,
  WorldEventPayloadMap,
  WorldEventInput,
  WorldEventListener,
  WorldEventType,
  WorldExternalEventInput,
  WorldForegroundFailure,
  WorldForegroundFailureKind,
  WorldForegroundOperation,
  WorldForegroundRecoveryState,
  WorldForegroundResponsibility,
  WorldDirectionInput,
  WorldMessageInput,
  WorldSubmitPlayerTurnInput,
  WorldAcknowledgePresentationInput,
  WorldUpdatePlayerCardInput,
  WorldMetadata,
  WorldNotification,
  WorldNotificationPayloadMap,
  WorldNotificationInput,
  WorldNotificationListener,
  WorldNotificationType,
  WorldProgressionInput,
  WorldRegisterActorInput,
  WorldRecordActorMemoryInput,
  WorldRelation,
  WorldReviseActorMemoryInput,
  WorldSetActorParticipationInput,
  WorldSetActorPresenceInput,
  WorldSnapshot,
  WorldRetryForegroundOperationInput,
  WorldDismissForegroundFailureInput,
  WorldUnsubscribe,
  WorldUpdateActorControlPolicyInput,
} from "./contracts/world.js";

// ── Inbox types ──
export type {
  HumanParticipant,
} from "./engine/input/index.js";

// Group authoring
export {
  defineGroupCard,
} from "./group/index.js";
export { worldDefinitionFromGroup } from "./group/to-world.js";
export { groupCardFromWorldDefinition } from "./group/from-world.js";
export type { GroupCardFromWorldOptions } from "./group/from-world.js";
export { DEFAULT_GROUP_RUNTIME_CONFIG, resolveGroupRuntimeConfig } from "./group/runtime-config.js";
export type { GroupRuntimeConfig, ResolvedGroupRuntimeConfig } from "./group/runtime-config.js";
export type {
  GroupCard,
  GroupWorldReference,
  GroupMetadata,
  RelationGraph,
  UserProfileCard,
} from "./group/index.js";

export type {
  ActorMemoryDebugSnapshot,
  WorldDebugCategory,
  WorldDebugConfig,
  WorldDebugEvent,
  WorldDebugLevel,
  WorldDebugListener,
  WorldDebugSnapshot,
  WorldTokenUsageBreakdown,
  WorldTokenUsageSnapshot,
  WorldTokenUsageTotals,
} from "./contracts/world-debug.js";
