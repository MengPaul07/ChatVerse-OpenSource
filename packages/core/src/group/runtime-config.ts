import type { ContextCompressionConfig } from "../contracts/chat.js";

/**
 * 可随群实例保存的运行配置。它描述"这群人如何聊天"，不包含 API Key、模型等连接凭据。
 * 所有字段均可省略；resolveGroupRuntimeConfig 会补全为安全的运行时默认值。
 */
export interface GroupRuntimeConfig {
  pacing?: {
    /** 统一缩放打字、动作、冷却与空闲等待。数值越大，世界节奏越慢。 */
    multiplier?: number;
  };
  messageStyle?: {
    /** 单次决策最多连续发送的消息数，范围 1-3；设为 1 即禁用连发。 */
    maxBurstCount?: number;
    /** 是否允许 {sticker:name} 形式的大表情独立成泡。 */
    allowStickers?: boolean;
    /** 给模型的倾向提示，不是字数硬限制。 */
    preferShortMessages?: boolean;
  };
  interaction?: {
    /** 用户发言后，距离发送较近的已排程消息仍会保留的时间窗口。 */
    interventionCommitWindowMs?: number;
  };
  harness?: {
    /** After three model-decided silent turns, require this character to produce a message. */
    forceSpeakAfterConsecutiveSilents?: boolean;
  };
  contextCompression?: Partial<ContextCompressionConfig>;
}

export interface ResolvedGroupRuntimeConfig {
  pacing: { multiplier: number };
  messageStyle: Required<NonNullable<GroupRuntimeConfig["messageStyle"]>>;
  interaction: { interventionCommitWindowMs: number };
  harness: { forceSpeakAfterConsecutiveSilents: boolean };
  contextCompression: ContextCompressionConfig;
}

export const DEFAULT_GROUP_RUNTIME_CONFIG: ResolvedGroupRuntimeConfig = {
  pacing: { multiplier: 1 },
  messageStyle: {
    maxBurstCount: 3,
    allowStickers: true,
    preferShortMessages: true,
  },
  interaction: { interventionCommitWindowMs: 5000 },
  harness: { forceSpeakAfterConsecutiveSilents: true },
  contextCompression: {
    historyTokenThreshold: 12000,
    recentHistoryTokens: 3000,
    summaryMaxTokens: 1200,
    factsLimit: 8,
  },
};

/** Merge group defaults and per-run overrides into a bounded core-safe configuration. */
export function resolveGroupRuntimeConfig(
  ...configs: Array<GroupRuntimeConfig | undefined>
): ResolvedGroupRuntimeConfig {
  const merged: GroupRuntimeConfig = {};
  for (const config of configs) mergeRuntimeConfig(merged, config);
  const compression = { ...DEFAULT_GROUP_RUNTIME_CONFIG.contextCompression, ...merged.contextCompression };

  return {
    pacing: {
      multiplier: clampNumber(merged.pacing?.multiplier, DEFAULT_GROUP_RUNTIME_CONFIG.pacing.multiplier, 0.25, 20),
    },
    messageStyle: {
      maxBurstCount: clampInteger(merged.messageStyle?.maxBurstCount, DEFAULT_GROUP_RUNTIME_CONFIG.messageStyle.maxBurstCount, 1, 3),
      allowStickers: merged.messageStyle?.allowStickers ?? DEFAULT_GROUP_RUNTIME_CONFIG.messageStyle.allowStickers,
      preferShortMessages: merged.messageStyle?.preferShortMessages ?? DEFAULT_GROUP_RUNTIME_CONFIG.messageStyle.preferShortMessages,
    },
    interaction: {
      interventionCommitWindowMs: clampInteger(
        merged.interaction?.interventionCommitWindowMs,
        DEFAULT_GROUP_RUNTIME_CONFIG.interaction.interventionCommitWindowMs,
        0,
        60_000,
      ),
    },
    harness: {
      forceSpeakAfterConsecutiveSilents:
        merged.harness?.forceSpeakAfterConsecutiveSilents
        ?? DEFAULT_GROUP_RUNTIME_CONFIG.harness.forceSpeakAfterConsecutiveSilents,
    },
    contextCompression: {
      historyTokenThreshold: compression.historyTokenThreshold === 0
        ? 0
        : clampInteger(compression.historyTokenThreshold, DEFAULT_GROUP_RUNTIME_CONFIG.contextCompression.historyTokenThreshold, 1000, 200_000),
      recentHistoryTokens: clampInteger(compression.recentHistoryTokens, DEFAULT_GROUP_RUNTIME_CONFIG.contextCompression.recentHistoryTokens, 500, 50_000),
      summaryMaxTokens: clampInteger(compression.summaryMaxTokens, DEFAULT_GROUP_RUNTIME_CONFIG.contextCompression.summaryMaxTokens, 200, 8_000),
      factsLimit: clampInteger(compression.factsLimit, DEFAULT_GROUP_RUNTIME_CONFIG.contextCompression.factsLimit, 1, 50),
    },
  };
}

/** Undefined values are absent overrides, not instructions to erase an earlier layer. */
function mergeRuntimeConfig(target: GroupRuntimeConfig, source: GroupRuntimeConfig | undefined): void {
  if (!source) return;
  target.pacing = mergeDefined(target.pacing, source.pacing);
  target.messageStyle = mergeDefined(target.messageStyle, source.messageStyle);
  target.interaction = mergeDefined(target.interaction, source.interaction);
  target.harness = mergeDefined(target.harness, source.harness);
  target.contextCompression = mergeDefined(target.contextCompression, source.contextCompression);
}

function mergeDefined<T extends object>(target: T | undefined, source: Partial<T> | undefined): T | undefined {
  if (!target && !source) return undefined;
  const result = { ...target } as T;
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}
