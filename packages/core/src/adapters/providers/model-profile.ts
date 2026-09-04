import type {
  ProviderCompatibility,
  ProviderModelProfile,
  ProviderProtocol,
  ProviderThinkingLevel,
} from "../../contracts/provider.js";

const DEFAULT_THINKING_LEVEL_MAP: Partial<Record<ProviderThinkingLevel, string | null>> = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

type BuiltInProfile = Omit<ProviderModelProfile, "id" | "name">;

/**
 * Concrete model metadata follows the same split used by PI: the protocol
 * driver is selected first, then the model contributes its own limits and
 * wire compatibility. Keep this table exact-match only; a model name is not
 * evidence that another model from the same vendor has the same API shape.
 */
const BUILT_IN_MODEL_PROFILES: Partial<Record<ProviderProtocol, Record<string, BuiltInProfile>>> = {
  "openai-chat": {
    "gpt-5.6-sol": openAIReasoningProfile(1_050_000, 131_072),
    "gpt-5.6-terra": openAIReasoningProfile(1_050_000, 131_072),
    "gpt-5.6-luna": openAIReasoningProfile(1_050_000, 131_072),
    "gpt-5.2": openAIReasoningProfile(400_000, 16_384),
    "gpt-5.1": openAIReasoningProfile(400_000, 16_384),
    "gpt-5-mini": openAIReasoningProfile(400_000, 32_768),
    "gpt-5-nano": openAIReasoningProfile(400_000, 16_384),
    "gpt-4.1": openAITextProfile(1_000_000, 32_768),
    "gpt-4o-mini": openAITextProfile(128_000, 16_384),
    "deepseek-chat": openAITextProfile(64_000, 8_192),
    "deepseek-reasoner": deepSeekReasoningProfile(64_000, 8_192),
    "deepseek-v4-flash": deepSeekReasoningProfile(1_048_576, 8_192),
    "deepseek-v4-pro": deepSeekReasoningProfile(1_048_576, 16_384),
    "glm-5.3": glmReasoningProfile(200_000, 32_768, false, false),
    "glm-5.3-flash": glmReasoningProfile(200_000, 32_768, false, false),
    "glm-5.2": glmReasoningProfile(200_000, 8_192, true),
    "glm-5.1": glmReasoningProfile(200_000, 8_192),
    "glm-5": glmReasoningProfile(200_000, 8_192),
    "glm-4.7": glmReasoningProfile(200_000, 8_192),
    "glm-4.5-air": glmReasoningProfile(128_000, 8_192),
    "qwen3-coder-plus": qwenReasoningProfile(1_048_576, 16_384),
    "MiniMax-M3": miniMaxReasoningProfile(1_000_000, 16_384),
  },
  "openai-responses": {
    "gpt-5.6-sol": openAIReasoningProfile(1_050_000, 131_072),
    "gpt-5.6-terra": openAIReasoningProfile(1_050_000, 131_072),
    "gpt-5.6-luna": openAIReasoningProfile(1_050_000, 131_072),
    "gpt-5.2": openAIReasoningProfile(400_000, 16_384),
    "gpt-5.1": openAIReasoningProfile(400_000, 16_384),
    "gpt-5-mini": openAIReasoningProfile(400_000, 32_768),
    "gpt-5-nano": openAIReasoningProfile(400_000, 16_384),
    "gpt-4.1": openAITextProfile(1_000_000, 32_768),
    "gpt-4o-mini": openAITextProfile(128_000, 16_384),
  },
  "anthropic-messages": {
    "claude-sonnet-4-20250514": anthropicReasoningProfile(200_000, 16_384),
    "claude-opus-4-20250514": anthropicReasoningProfile(200_000, 16_384),
    "claude-3-5-haiku-20241022": anthropicTextProfile(200_000, 8_192),
  },
};

/**
 * Unknown models retain the portable adapter defaults. Concrete models are
 * resolved from the exact-match table below, while browser-supplied metadata
 * can further narrow or extend that profile for a compatible gateway.
 */
export function createFallbackModelProfile(
  protocol: ProviderProtocol,
  model: string,
): ProviderModelProfile {
  const compatibility: ProviderCompatibility = protocol === "anthropic-messages"
    ? {
        supportsTools: true,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: true,
        supportsFinishReason: true,
        maxTokensField: "max_tokens",
        supportsStrictTools: false,
        supportsFullJsonSchema: true,
        toolChoiceFormat: "object",
      }
    : {
        supportsTools: true,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: true,
        supportsFinishReason: true,
        maxTokensField: "max_tokens",
        supportsStrictTools: false,
        supportsFullJsonSchema: true,
        toolChoiceFormat: "string",
      };
  const fallback: ProviderModelProfile = {
    id: model,
    name: model,
    reasoning: false,
    input: ["text"],
    thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP,
    compatibility,
  };
  const builtIn = BUILT_IN_MODEL_PROFILES[protocol]?.[model];
  return builtIn
    ? mergeProfile(fallback, builtIn, model)
    : fallback;
}

/** Return a cloned built-in profile for catalog and server integrations. */
export function getBuiltInModelProfile(
  protocol: ProviderProtocol,
  model: string,
): ProviderModelProfile | undefined {
  const builtIn = BUILT_IN_MODEL_PROFILES[protocol]?.[model];
  if (!builtIn) return undefined;
  return mergeProfile(createFallbackModelProfile(protocol, model), builtIn, model);
}

/** Normalize browser-supplied metadata without allowing it to rename a request. */
export function resolveModelProfile(
  protocol: ProviderProtocol,
  model: string,
  explicit?: ProviderModelProfile,
): ProviderModelProfile {
  const fallback = createFallbackModelProfile(protocol, model);
  // A stale profile must never alter a different role's model. PI treats the
  // concrete model id as part of the profile identity, so discard mismatches.
  if (!explicit || explicit.id !== model) return fallback;
  return mergeProfile(fallback, explicit, model);
}

function mergeProfile(
  fallback: ProviderModelProfile,
  explicit: Omit<ProviderModelProfile, "id"> | ProviderModelProfile,
  model: string,
): ProviderModelProfile {
  return {
    ...fallback,
    ...explicit,
    id: model,
    name: explicit.name || model,
    input: explicit.input?.length ? [...explicit.input] : fallback.input,
    compatibility: {
      ...fallback.compatibility,
      ...(explicit.compatibility ?? {}),
    },
    ...(explicit.thinkingLevelMap
      ? { thinkingLevelMap: { ...explicit.thinkingLevelMap } }
      : {}),
    ...(explicit.samplingParams
      ? { samplingParams: { ...explicit.samplingParams } }
      : {}),
  };
}

function openAIReasoningProfile(contextWindow: number, maxTokens: number): BuiltInProfile {
  return {
    reasoning: true,
    input: ["text", "image"],
    contextWindow,
    maxTokens,
    thinkingLevelMap: {
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    compatibility: {
      supportsTools: true,
      supportsDeveloperRole: true,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      supportsFinishReason: true,
      maxTokensField: "max_completion_tokens",
      supportsStrictTools: true,
      supportsFullJsonSchema: true,
      toolChoiceFormat: "string",
      thinkingFormat: "openai",
    },
  };
}

function openAITextProfile(contextWindow: number, maxTokens: number): BuiltInProfile {
  return {
    reasoning: false,
    input: ["text", "image"],
    contextWindow,
    maxTokens,
    thinkingLevelMap: { off: "none" },
    compatibility: {
      supportsTools: true,
      supportsDeveloperRole: true,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      supportsFinishReason: true,
      maxTokensField: "max_tokens",
      supportsStrictTools: true,
      supportsFullJsonSchema: true,
      toolChoiceFormat: "string",
      thinkingFormat: "none",
    },
  };
}

function deepSeekReasoningProfile(contextWindow: number, maxTokens: number): BuiltInProfile {
  return {
    reasoning: true,
    input: ["text"],
    contextWindow,
    maxTokens,
    thinkingLevelMap: { off: "off", low: "low", medium: "medium", high: "high", max: "max" },
    compatibility: {
      supportsTools: true,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      supportsFinishReason: true,
      maxTokensField: "max_tokens",
      supportsStrictTools: false,
      supportsFullJsonSchema: false,
      toolChoiceFormat: "string",
      thinkingFormat: "deepseek",
    },
  };
}

function glmReasoningProfile(
  contextWindow: number,
  maxTokens: number,
  supportsReasoningEffort = false,
  supportsThinkingDisable = true,
): BuiltInProfile {
  return {
    reasoning: true,
    input: ["text"],
    contextWindow,
    maxTokens,
    thinkingLevelMap: { off: "off", minimal: "minimal", high: "high", max: "max" },
    compatibility: {
      supportsTools: true,
      supportsReasoningEffort,
      supportsThinkingDisable,
      supportsUsageInStreaming: true,
      supportsFinishReason: true,
      maxTokensField: "max_tokens",
      supportsStrictTools: false,
      supportsFullJsonSchema: false,
      toolChoiceFormat: "string",
      thinkingFormat: "zai",
      supportsToolCallStreaming: true,
    },
  };
}

function qwenReasoningProfile(contextWindow: number, maxTokens: number): BuiltInProfile {
  return {
    reasoning: true,
    input: ["text"],
    contextWindow,
    maxTokens,
    thinkingLevelMap: { off: "off", low: "low", medium: "medium", high: "high", max: "max" },
    compatibility: {
      supportsTools: true,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      supportsFinishReason: true,
      maxTokensField: "max_tokens",
      supportsStrictTools: false,
      supportsFullJsonSchema: false,
      toolChoiceFormat: "string",
      thinkingFormat: "qwen",
    },
  };
}

function miniMaxReasoningProfile(contextWindow: number, maxTokens: number): BuiltInProfile {
  return {
    ...qwenReasoningProfile(contextWindow, maxTokens),
    input: ["text", "image"],
    compatibility: {
      ...qwenReasoningProfile(contextWindow, maxTokens).compatibility,
      thinkingFormat: "string-thinking",
    },
  };
}

function anthropicReasoningProfile(contextWindow: number, maxTokens: number): BuiltInProfile {
  return {
    reasoning: true,
    input: ["text", "image"],
    contextWindow,
    maxTokens,
    thinkingLevelMap: { off: null, high: "high", max: "max" },
    compatibility: {
      supportsTools: true,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      supportsFinishReason: true,
      maxTokensField: "max_tokens",
      supportsStrictTools: true,
      supportsFullJsonSchema: true,
      toolChoiceFormat: "object",
      supportsLongCacheRetention: true,
      supportsCacheControlOnTools: true,
      cacheControlFormat: "anthropic",
    },
  };
}

function anthropicTextProfile(contextWindow: number, maxTokens: number): BuiltInProfile {
  return {
    reasoning: false,
    input: ["text", "image"],
    contextWindow,
    maxTokens,
    thinkingLevelMap: { off: null },
    compatibility: {
      supportsTools: true,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      supportsFinishReason: true,
      maxTokensField: "max_tokens",
      supportsStrictTools: true,
      supportsFullJsonSchema: true,
      toolChoiceFormat: "object",
      thinkingFormat: "none",
    },
  };
}
