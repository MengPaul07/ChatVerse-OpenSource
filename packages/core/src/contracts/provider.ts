// ── Provider 协议与能力 ──

/** Runtime registry and type source for the text protocols supported by Core. */
export const PROVIDER_PROTOCOLS = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
] as const;

export type ProviderProtocol = typeof PROVIDER_PROTOCOLS[number];

export function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return typeof value === "string"
    && (PROVIDER_PROTOCOLS as readonly string[]).includes(value);
}

/** Web research uses independent wire protocols and credentials. */
export const WEB_RESEARCH_PROTOCOLS = [
  "responses-web-search",
  "tavily-search",
  "zhipu-web-search",
] as const;

export type WebResearchProtocol = typeof WEB_RESEARCH_PROTOCOLS[number];

export function isWebResearchProtocol(value: unknown): value is WebResearchProtocol {
  return typeof value === "string"
    && (WEB_RESEARCH_PROTOCOLS as readonly string[]).includes(value);
}

export type ProviderJsonCapability = "native" | "prompt" | "none";
export type ProviderReasoningCapability = "native" | "option" | "none";
export type ProviderToolChoiceCapability = "auto" | "required";

/** Thinking levels exposed by the model catalog. */
export type ProviderThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Provider-specific wire format used for model thinking controls. */
export type ProviderThinkingFormat =
  | "openai"
  | "none"
  | "reasoning_effort"
  | "openrouter"
  | "deepseek"
  | "together"
  | "baseten"
  | "zai"
  | "qwen"
  | "chat-template"
  | "qwen-chat-template"
  | "string-thinking"
  | "ant-ling";

/** Compatibility switches modeled after PI's provider/model compat layer. */
export interface ProviderCompatibility {
  supportsStore?: boolean;
  supportsTools?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  /** False when the model requires thinking to remain enabled on every request. */
  supportsThinkingDisable?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsFinishReason?: boolean;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  requiresToolResultName?: boolean;
  thinkingFormat?: ProviderThinkingFormat;
  supportsStrictTools?: boolean;
  /** Whether the endpoint accepts the full JSON Schema vocabulary. */
  supportsFullJsonSchema?: boolean;
  /** Some compatible gateways only accept string values for tool_choice. */
  toolChoiceFormat?: "string" | "object";
  /** Optional template arguments used by qwen-chat-template providers. */
  chatTemplateKwargs?: Record<string, unknown>;
  /** Some gateways require an assistant turn between tool results and users. */
  requiresAssistantAfterToolResult?: boolean;
  /** Some gateways cannot replay hidden reasoning blocks as structured content. */
  requiresThinkingAsText?: boolean;
  /** OpenAI-compatible gateways that can stream function arguments use this extension. */
  supportsToolCallStreaming?: boolean;
  /** DeepSeek-compatible gateways may require this field on every replayed tool turn. */
  requiresReasoningContentOnAssistantMessages?: boolean;
  /** Optional top-level field used by vLLM/Qwen-like thinking budgets. */
  thinkingTokenBudgetField?: "thinking_token_budget" | "thinking_budget" | "thinking_budget_tokens";
  /** Anthropic-compatible endpoints can opt into adaptive thinking. */
  supportsEagerToolInputStreaming?: boolean;
  supportsLongCacheRetention?: boolean;
  supportsCacheControlOnTools?: boolean;
  forceAdaptiveThinking?: boolean;
  allowEmptySignature?: boolean;
  cacheControlFormat?: "anthropic";
}

/** Model-level metadata and compatibility settings. No credentials belong here. */
export interface ProviderModelProfile {
  id: string;
  name?: string;
  reasoning: boolean;
  input: ReadonlyArray<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Partial<Record<ProviderThinkingLevel, string | null>>;
  samplingParams?: Record<string, unknown>;
  compatibility?: ProviderCompatibility;
}

export interface ProviderCapabilities {
  stream: boolean;
  tools: boolean;
  json: ProviderJsonCapability;
  reasoning: ProviderReasoningCapability;
  webSearch: boolean;
  vision: boolean;
  /** Strongest tool-choice mode accepted by the configured endpoint. */
  toolChoice?: ProviderToolChoiceCapability;
}

export interface ProviderProfile {
  protocol: ProviderProtocol;
  providerName: string;
  model: string;
  baseURL?: string;
  capabilities: ProviderCapabilities;
  modelProfile: ProviderModelProfile;
  compatibility: ProviderCompatibility;
  contextWindow?: number;
  maxOutputTokens?: number;
  providerOptions?: Record<string, unknown>;
}

// ── LLM 消息 & Tool Calling 类型 ──

/** LLM 多轮对话消息 */
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** 协议无关的隐藏推理内容。适配器决定是否可以回传。 */
  reasoningContent?: string;
}

/** LLM 返回的 tool call */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON string */
    arguments: string;
  };
}

/** 注册给 LLM 的 tool 定义 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

/** chat() 方法的返回值 */
export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  /** 协议无关的隐藏推理内容。 */
  reasoningContent?: string;
  finishReason?: "stop" | "tool_calls" | "max_tokens" | "content_filter" | "unknown";
  usage?: TokenUsage;
}

export type LLMResponseFormat = { type: "json_object" };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  reasoningTokens?: number;
  provider?: string;
  model?: string;
  protocol?: ProviderProtocol;
}

export type ProviderUsageOperation = "complete" | "stream" | "chat" | "research";

export interface ProviderUsageObservation {
  operation: ProviderUsageOperation;
  requestContext?: ProviderRequestContext;
  usage: TokenUsage;
}

export type ProviderUsageRole =
  | "character"
  | "history_compression"
  | "world_director"
  | "world_narrator"
  | "player_actor"
  | "actor_memory"
  | "world_authoring"
  | "world_authoring_research";

export interface ProviderUsageEvent extends ProviderUsageObservation {
  providerRole: ProviderUsageRole;
}

export type ProviderUsageEventListener = (event: ProviderUsageEvent) => void;

export interface ProviderRequestContext {
  purpose:
    | "world_director"
    | "world_narrator"
    | "actor_decision"
    | "player_actor"
    | "actor_response"
    | "actor_memory"
    | "world_authoring"
    | "world_authoring_research"
    | "history_compression"
    | "other";
  turnId?: string;
  contextId?: string;
  actorId?: string;
  characterName?: string;
}

export type TokenUsageListener = (usage: TokenUsage) => void;

/** A source returned by a provider-side web research request. */
export interface WebResearchSource {
  title: string;
  url: string;
  accessedAt: number;
  note: string;
}

export interface WebResearchResult {
  summary: string;
  sources: WebResearchSource[];
}

export interface WebResearchProfile {
  protocol: WebResearchProtocol;
  providerName: string;
  baseURL: string;
  model?: string;
}

/** Optional provider capability used by World Studio only. */
export interface WebResearchProvider {
  readonly profile?: WebResearchProfile;
  search(params: {
    query: string;
    purpose: string;
    signal?: AbortSignal;
    requestContext?: ProviderRequestContext;
    onUsage?: TokenUsageListener;
  }): Promise<WebResearchResult>;
}

/** Model adapter contract. Concrete SDK bindings live in adapters/providers. */
export interface ChatProvider {
  /** Concrete providers expose their effective protocol and capabilities. */
  readonly profile?: ProviderProfile;
  complete(params: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    responseFormat?: LLMResponseFormat;
    /** Provider-specific reasoning toggle; adapters may ignore it. */
    thinking?: "enabled" | "disabled";
    /** Provider-specific reasoning budget. `off` disables thinking where supported. */
    reasoningEffort?: "off" | "minimal" | "high" | "max";
    signal?: AbortSignal;
    requestContext?: ProviderRequestContext;
    onUsage?: TokenUsageListener;
  }): Promise<string>;
  stream(params: {
    systemPrompt: string;
    userPrompt: string;
    signal?: AbortSignal;
    requestContext?: ProviderRequestContext;
    onUsage?: TokenUsageListener;
  }): AsyncIterable<string>;
  chat(params: {
    messages: LLMMessage[];
    tools?: ToolDefinition[];
    /** Ask a tool-capable model to emit at least one tool call for an explicit task. */
    toolChoice?: "auto" | "required" | "none";
    /** Provider-specific reasoning toggle; adapters may ignore it. */
    thinking?: "enabled" | "disabled";
    /** Provider-specific reasoning budget. `off` disables thinking. */
    reasoningEffort?: "off" | "minimal" | "high" | "max";
    maxTokens?: number;
    /** Use the protocol's streaming transport while still returning one normalized response. */
    stream?: boolean;
    signal?: AbortSignal;
    requestContext?: ProviderRequestContext;
    onUsage?: TokenUsageListener;
    /** Visible assistant text only. Hidden reasoning is never forwarded. */
    onTextDelta?: (delta: string) => void;
  }): Promise<ChatResponse>;
}

// ── Provider 配置 ──
