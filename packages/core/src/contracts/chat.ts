// ══════════════════════════════════════════════
// 卡片类型：用户直接使用的数据模型
// ══════════════════════════════════════════════

/**
 * 人物卡：一个角色的完整定义。
 * 字段设计参考 TavernCardV2 `data`，但只保留运行时真正使用的内容。
 */
export interface ActorVisualProfile {
  /** Stable appearance description used by presentation and image generation. */
  appearance: string;
  portraitAssetId?: string;
  portraitPrompt?: string;
}

export interface CharacterCard {
  name: string;
  description: string;
  /** 性格与说话方式，使用自然语言描述。 */
  personality: string;
  /**
   * 角色的默认处境与既有认知。
   * Group 将其视为群内自我认知；World 将其视为角色自己的世界背景。
   */
  scenario: string;
  /** 对话示例，用于约束模型语气。 */
  messageExample: string;
  /** 角色专属行为边界与补充指令。 */
  instructions?: string;
  /** 角色专属世界书。 */
  loreBook?: LoreBook;
  /** Optional reusable presentation metadata. Image bytes live outside Core. */
  visual?: ActorVisualProfile;
}

/** 世界书：一组按关键词触发的上下文条目。 */
export interface LoreBook {
  name?: string;
  description?: string;
  entries: LoreBookEntry[];
}

/** 世界书条目。 */
export interface LoreBookEntry {
  keys: string[];
  content: string;
  priority: number;
  position: "before" | "after";
  constant: boolean;
}

/** 当前互动上下文的场景设定。 */
export interface SceneCard {
  groupName: string;
  topic: string;
  atmosphere: string;
  /** 对话状态：flowing=自然流动，heated=激烈，winding_down=冷却，idle=安静，paused=暂停。 */
  state?: "flowing" | "heated" | "winding_down" | "idle" | "paused";
  rules?: string[];
}

/** 角色之间的单向关系描述。 */
export interface Relation {
  from: string;
  to: string;
  description: string;
}

// ══════════════════════════════════════════════
// 角色运行时状态：独立于人物卡
// ══════════════════════════════════════════════

/** 角色运行时状态快照。 */
export interface CharacterState {
  characterName: string;
  availability: "available" | "away" | "unavailable";
  attention: "active" | "lurking" | "distracted";
  mood?: string;
  intent?: string;
  note?: string;
  updatedAt: number;
  source: "character" | "director" | "user" | "system";
}

/** 一条已提交的聊天消息。 */
export interface ChatMessage {
  id: string;
  characterName: string;
  message: string;
  timestamp: number;
  source: "character" | "human";
}

/** A visible action performed by one character. It is not a chat message. */
export interface ActorAction {
  id: string;
  characterName: string;
  action: string;
  /** Optional self-authored Context transition. Only World sessions apply it. */
  contextTransition?: "leave";
  timestamp: number;
}

// ══════════════════════════════════════════════
// Provider 接口
// ══════════════════════════════════════════════

import type { ChatProvider } from "./provider.js";
import type { DebugConfig } from "./debug.js";
import type { HumanParticipant } from "../engine/input/types.js";
import type { ConversationDigest } from "./conversation.js";
import type { ScheduledMessage } from "./queue.js";
import type { RuntimeHost } from "../runtime/types.js";

export type { CharacterStatePatch } from "./actor-state.js";

// ══════════════════════════════════════════════
// 引擎配置
// ══════════════════════════════════════════════

/** ChatVerse 引擎配置。至少需要提供一个 Provider。 */
export type ChatVerseConfig = (
  | { provider: ChatProvider; directorProvider?: ChatProvider; characterProvider?: ChatProvider }
  | { directorProvider: ChatProvider; characterProvider?: ChatProvider }
) & {
  /** Optional runtime host shared by sessions created through this engine. */
  runtime?: RuntimeHost;
};

export interface SessionConfig {
  characters: CharacterCard[];
  humans?: HumanParticipant[];
  worldBook?: LoreBook;
  scene: SceneCard;
  relations: Relation[];
  debug?: DebugConfig;
  /** World-only conversation surface. Private contexts use a small prompt overlay. */
  conversationMode?: "group" | "private";
  /** User intervention will not cancel scheduled messages due within this window. Default: 5000ms. */
  interventionCommitWindowMs?: number;
  /** Global pacing multiplier applied to typing, actions, idle checks, and cooldowns. Larger values are slower. Default: 1. */
  pacingMultiplier?: number;
  /** Message-form policy applied to Actor output. */
  messageStyle?: SessionMessageStyleConfig;
  /** In Harness mode, force a character to continue after three model-decided silent turns. Default: true. */
  forceSpeakAfterConsecutiveSilents?: boolean;
  /** Long-history compression policy. Set historyTokenThreshold to 0 to disable it. */
  contextCompression?: Partial<ContextCompressionConfig>;
  /** Previously committed messages used to seed a newly created session. */
  initialMessages?: ChatMessage[];
}

export interface SessionMessageStyleConfig {
  maxBurstCount?: number;
  allowStickers?: boolean;
  preferShortMessages?: boolean;
}

/** Token limits for LLM-backed conversation-history compression. */
export interface ContextCompressionConfig {
  /** Start a background compression once unsummarized history reaches this size. Default: 12000. */
  historyTokenThreshold: number;
  /** Keep this many newest history tokens verbatim after each successful compression. Default: 3000. */
  recentHistoryTokens: number;
  /** Upper bound for the resulting digest response. Default: 1200. */
  summaryMaxTokens: number;
  /** Maximum number of short current facts retained in the digest. Default: 8. */
  factsLimit: number;
}

/** 会话快照：可用于保存/恢复 */
export interface SessionSnapshot {
  id: string;
  messages: ChatMessage[];
  actions: ActorAction[];
  scene: {
    groupName: string;
    topic: string;
    atmosphere: string;
    state: NonNullable<SceneCard["state"]>;
    rules?: string[];
  };
  characterStates: CharacterState[];
  scheduledMessages: ScheduledMessage[];
  conversationDigest?: ConversationDigest;
  timestamp: number;
}
