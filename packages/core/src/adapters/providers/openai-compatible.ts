import OpenAI from "openai";
import type {
  ChatProvider,
  LLMMessage,
  ChatResponse,
  TokenUsage,
  ToolCall,
  ToolDefinition,
  ProviderCapabilities,
  ProviderCompatibility,
  ProviderModelProfile,
  ProviderProfile,
} from "../../contracts/provider.js";
import {
  asRecord,
  createRequestSignal,
  reportUsage,
  sanitizeToolSchema,
  wrapProviderError,
} from "./provider-utils.js";
import { resolveModelProfile } from "./model-profile.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 32_768;

/**
 * OpenAI Chat Completions protocol driver.
 * Any service that implements this protocol uses the same adapter. Vendor
 * extensions are opt-in through the namespaced providerOptions field.
 */
export interface OpenAIChatProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  /** Public label used for usage and debug output. */
  providerName?: string;
  providerOptions?: Record<string, unknown>;
  /** PI-style metadata for the concrete model behind this endpoint. */
  modelProfile?: ProviderModelProfile;
  capabilities?: Partial<ProviderCapabilities>;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Optional SDK request timeout. Omit to keep the SDK default. */
  timeoutMs?: number;
  /** Optional SDK retry count. Omit to keep the SDK default. */
  maxRetries?: number;
}

interface OpenAIProviderOptions {
  thinking: boolean;
  reasoningEffort: boolean;
  omitToolChoiceWhenThinking: boolean;
  toolChoice: "auto" | "required";
}

function openAIProviderOptions(value: Record<string, unknown> | undefined): OpenAIProviderOptions {
  const root = asRecord(value?.openai) ?? {};
  return {
    thinking: root.thinking === true,
    reasoningEffort: root.reasoningEffort === undefined
      ? root.thinking === true
      : root.reasoningEffort === true,
    omitToolChoiceWhenThinking: root.omitToolChoiceWhenThinking === true,
    // OpenAI-compatible endpoints are not required to implement the
    // `required` extension. Unknown/custom endpoints therefore start at the
    // portable mode and can opt into `required` explicitly.
    toolChoice: root.toolChoice === "required" ? "required" : "auto",
  };
}

function createOpenAIChatProfile(
  config: OpenAIChatProviderConfig,
  providerName: string,
  model: string,
  baseURL: string,
  options: OpenAIProviderOptions,
  modelProfile: ProviderModelProfile,
  compatibility: ProviderCompatibility,
): ProviderProfile {
  const capabilities: ProviderCapabilities = {
    stream: true,
    tools: compatibility.supportsTools !== false,
    json: "native",
    reasoning: (modelProfile.reasoning || compatibility.thinkingFormat === undefined)
      && (options.thinking || options.reasoningEffort)
      ? "option"
      : "none",
    webSearch: false,
    vision: modelProfile.input.includes("image"),
    toolChoice: compatibility.supportsTools === false ? undefined : options.toolChoice,
    ...config.capabilities,
  };
  return {
    protocol: "openai-chat",
    providerName,
    model,
    baseURL,
    capabilities,
    modelProfile,
    compatibility,
    contextWindow: config.contextWindow ?? modelProfile.contextWindow,
    maxOutputTokens: config.maxOutputTokens ?? modelProfile.maxTokens,
    providerOptions: config.providerOptions,
  };
}

export function createOpenAIChatProvider(config: OpenAIChatProviderConfig): ChatProvider {
  const providerName = config.providerName ?? "openai-compatible";
  const model = config.model ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? DEFAULT_BASE_URL;
  const options = openAIProviderOptions(config.providerOptions);
  const resolvedModelProfile = resolveModelProfile("openai-chat", model, config.modelProfile);
  const compatibility = normalizeCompatibility(model, resolvedModelProfile);
  const modelProfile: ProviderModelProfile = {
    ...resolvedModelProfile,
    compatibility,
  };
  const profile = createOpenAIChatProfile(
    config,
    providerName,
    model,
    baseURL,
    options,
    modelProfile,
    compatibility,
  );
  const requestTimeoutMs = compatibility.supportsThinkingDisable === false
    ? Math.max(config.timeoutMs ?? 0, 180_000)
    : config.timeoutMs;
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL,
    ...(requestTimeoutMs === undefined ? {} : { timeout: requestTimeoutMs }),
    ...(config.maxRetries === undefined ? {} : { maxRetries: config.maxRetries }),
  });

  return {
    // ── 单次补全 ──
    async complete({ systemPrompt, userPrompt, maxTokens, responseFormat, thinking, reasoningEffort, signal, onUsage }) {
      const request = createRequestSignal(signal, requestTimeoutMs);
      try {
        const res = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          ...maxTokenField(maxTokens ?? DEFAULT_MAX_TOKENS, compatibility),
          response_format: responseFormat,
          ...thinkingFields(thinking, reasoningEffort, options, modelProfile, maxTokens),
          ...(modelProfile.samplingParams ?? {}),
        }, { signal: request.signal });
        reportUsage(onUsage, normalizeTokenUsage(res.usage, res.model ?? model, providerName));
        return res.choices[0]?.message?.content ?? "";
      } catch (error) {
        throw wrapProviderError(request.wrapError(error), {
          protocol: "openai-chat",
          provider: providerName,
          model,
        });
      } finally {
        request.cleanup();
      }
    },

    // ── 流式补全 ──
    async *stream({ systemPrompt, userPrompt, signal, onUsage }) {
      const request = createRequestSignal(signal, requestTimeoutMs);
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          ...maxTokenField(DEFAULT_MAX_TOKENS, compatibility),
          stream: true,
          ...(compatibility.supportsUsageInStreaming === false
            ? {}
            : { stream_options: { include_usage: true } }),
        }, { signal: request.signal });

        for await (const chunk of stream) {
          reportUsage(onUsage, normalizeTokenUsage(chunk.usage, chunk.model ?? model, providerName));
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield delta;
        }
      } catch (error) {
        throw wrapProviderError(request.wrapError(error), {
          protocol: "openai-chat",
          provider: providerName,
          model,
        });
      } finally {
        request.cleanup();
      }
    },

    // ── 多轮对话（tool calling）──
    async chat({
      messages,
      tools,
      toolChoice,
      thinking,
      reasoningEffort,
      maxTokens,
      stream,
      signal,
      onUsage,
      onTextDelta,
    }): Promise<ChatResponse> {
      const request = createRequestSignal(signal, requestTimeoutMs);
      const compatibleToolChoice = toolChoiceForThinkingMode(
        compatibility.supportsTools === false ? undefined : toolChoice,
        options,
        resolveThinking(thinking, reasoningEffort),
      );
      try {
        if (stream || onTextDelta) {
          return await streamChatCompletion({
            client,
            model,
            messages,
            tools,
            toolChoice: compatibleToolChoice,
            thinking: resolveThinking(thinking, reasoningEffort),
            reasoningEffort,
            provider: providerName,
            options,
            modelProfile,
            compatibility,
            maxTokens,
            signal: request.signal,
            onProgress: request.touch,
            onUsage,
            onTextDelta,
          });
        }
        const res = await client.chat.completions.create({
          model,
          messages: toOpenAIMessages(messages, compatibility),
          tools: toOpenAITools(tools, compatibility),
          ...(compatibleToolChoice ? { tool_choice: compatibleToolChoice } : {}),
          ...maxTokenField(maxTokens ?? DEFAULT_MAX_TOKENS, compatibility),
          ...thinkingFields(thinking, reasoningEffort, options, modelProfile, maxTokens),
          ...(modelProfile.samplingParams ?? {}),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, { signal: request.signal });

        const response = toChatResponse(res, model, providerName);
        reportUsage(onUsage, response.usage);
        return response;
      } catch (error) {
        throw wrapProviderError(request.wrapError(error), {
          protocol: "openai-chat",
          provider: providerName,
          model,
        });
      } finally {
        request.cleanup();
      }
    },
    profile,
  };
}

function normalizeCompatibility(
  model: string,
  modelProfile: ProviderModelProfile,
): ProviderCompatibility {
  const compatibility = modelProfile.compatibility ?? {};
  const modelId = `${model} ${modelProfile.id}`.toLowerCase();
  if (!/(?:^|[\s/:])glm-5\.3(?:-flash)?(?:$|[\s:[/])/.test(modelId)) return compatibility;
  return {
    ...compatibility,
    supportsReasoningEffort: false,
    supportsThinkingDisable: false,
    thinkingFormat: "zai",
  };
}

function toOpenAIMessages(
  messages: LLMMessage[],
  compatibility: ProviderCompatibility = {},
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function.name);
  }
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  let previousWasToolResult = false;
  for (const message of messages) {
    if (message.role !== "assistant") {
      if (message.role === "tool") {
        result.push({
          role: "tool",
          content: message.content,
          tool_call_id: message.tool_call_id ?? "unknown-tool-call",
          ...(compatibility.requiresToolResultName
            ? { name: toolNames.get(message.tool_call_id ?? "") ?? "tool" }
            : {}),
        } as OpenAI.Chat.Completions.ChatCompletionToolMessageParam);
        previousWasToolResult = true;
        continue;
      }
      if (message.role === "user"
        && previousWasToolResult
        && compatibility.requiresAssistantAfterToolResult) {
        result.push({ role: "assistant", content: "" });
      }
      result.push(message as OpenAI.Chat.Completions.ChatCompletionMessageParam);
      previousWasToolResult = false;
      continue;
    }
    const toolCalls = message.tool_calls ?? [];
    const content = compatibility.requiresThinkingAsText && message.reasoningContent
      ? `<thinking>\n${message.reasoningContent}\n</thinking>${message.content ?? ""}`
      : message.content ?? "";
    result.push({
      role: "assistant",
      content,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      ...(toolCalls.length > 0
        && (message.reasoningContent || compatibility.requiresReasoningContentOnAssistantMessages)
        ? { reasoning_content: message.reasoningContent ?? "" }
        : {}),
    } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);
    previousWasToolResult = false;
  }
  return result;
}

function toOpenAITools(
  tools?: ToolDefinition[],
  compatibility: ProviderCompatibility = {},
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools?.length || compatibility.supportsTools === false) return undefined;
  return tools.map((tool) => {
    const { strict, ...definition } = tool.function;
    return {
      type: "function",
      function: {
        ...definition,
        ...(strict && compatibility.supportsStrictTools !== false ? { strict: true } : {}),
        parameters: sanitizeToolSchema(tool.function.parameters, compatibility),
      },
    };
  });
}

function toChatResponse(
  res: OpenAI.Chat.Completions.ChatCompletion,
  fallbackModel: string,
  provider: string,
): ChatResponse {
  const msg = res.choices[0]?.message;

  return {
    content: msg?.content ?? null,
    reasoningContent: (msg as (typeof msg & { reasoning_content?: string }) | undefined)
      ?.reasoning_content,
    toolCalls: normalizeToolCalls(msg?.tool_calls),
    finishReason: normalizeFinishReason(res.choices[0]?.finish_reason),
    usage: normalizeTokenUsage(res.usage, res.model ?? fallbackModel, provider),
  };
}

async function streamChatCompletion(input: {
  client: OpenAI;
  model: string;
  provider: string;
  options: OpenAIProviderOptions;
  modelProfile: ProviderModelProfile;
  compatibility: ProviderCompatibility;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "off" | "minimal" | "high" | "max";
  maxTokens?: number;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
  onTextDelta?: (delta: string) => void;
  onProgress?: () => void;
}): Promise<ChatResponse> {
  const stream = await input.client.chat.completions.create({
    model: input.model,
    messages: toOpenAIMessages(input.messages, input.compatibility),
    tools: toOpenAITools(input.tools, input.compatibility),
    ...(input.toolChoice && input.compatibility.supportsTools !== false
      ? { tool_choice: input.toolChoice }
      : {}),
    ...maxTokenField(input.maxTokens ?? DEFAULT_MAX_TOKENS, input.compatibility),
    stream: true,
    ...(input.compatibility.supportsToolCallStreaming ? { tool_stream: true } : {}),
    ...(input.compatibility.supportsUsageInStreaming === false
      ? {}
      : { stream_options: { include_usage: true } }),
    ...thinkingFields(input.thinking, input.reasoningEffort, input.options, input.modelProfile, input.maxTokens),
    ...(input.modelProfile.samplingParams ?? {}),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, { signal: input.signal });
  const calls = new Map<number, {
    id: string;
    name: string;
    arguments: string;
  }>();
  let content = "";
  let reasoningContent = "";
  let usage: TokenUsage | undefined;
  let finishReason: ChatResponse["finishReason"];

  for await (const chunk of stream) {
    input.onProgress?.();
    const normalizedUsage = normalizeTokenUsage(chunk.usage, chunk.model ?? input.model, input.provider);
    if (normalizedUsage) usage = normalizedUsage;
    const delta = chunk.choices[0]?.delta;
    const wireFinishReason = chunk.choices[0]?.finish_reason;
    if (wireFinishReason && input.compatibility.supportsFinishReason !== false) {
      finishReason = normalizeFinishReason(wireFinishReason);
    }
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      try {
        input.onTextDelta?.(delta.content);
      } catch {
        // Streaming observers cannot interrupt a successful Provider request.
      }
    }
    const reasoning = (delta as { reasoning_content?: string }).reasoning_content;
    if (reasoning) reasoningContent += reasoning;
    for (const toolCall of delta.tool_calls ?? []) {
      const current = calls.get(toolCall.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      if (toolCall.id) current.id = toolCall.id;
      if (toolCall.function?.name) current.name += toolCall.function.name;
      if (toolCall.function?.arguments) {
        current.arguments += toolCall.function.arguments;
      }
      calls.set(toolCall.index, current);
    }
  }
  reportUsage(input.onUsage, usage);
  if (!finishReason) finishReason = calls.size > 0 ? "tool_calls" : "stop";
  return {
    content: content || null,
    reasoningContent: reasoningContent || undefined,
    toolCalls: [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call], index) => ({
        id: call.id || `stream-tool-${index + 1}`,
        type: "function" as const,
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    finishReason,
    usage,
  };
}

function resolveThinking(
  thinking: "enabled" | "disabled" | undefined,
  reasoningEffort: "off" | "minimal" | "high" | "max" | undefined,
): "enabled" | "disabled" | undefined {
  if (reasoningEffort === "off") return "disabled";
  if (reasoningEffort === "minimal" || reasoningEffort === "high" || reasoningEffort === "max") return "enabled";
  return thinking;
}

function thinkingFields(
  thinking: "enabled" | "disabled" | undefined,
  reasoningEffort: "off" | "minimal" | "high" | "max" | undefined,
  options: OpenAIProviderOptions,
  modelProfile?: ProviderModelProfile,
  maxTokens?: number,
): Record<string, unknown> {
  const resolved = resolveThinking(thinking, reasoningEffort);
  const compatibility = modelProfile?.compatibility;
  // Unknown models can still opt into an extension through providerOptions;
  // a concrete profile with `thinkingFormat: none` is an explicit denial.
  if (modelProfile && compatibility?.thinkingFormat === "none") return {};
  if (modelProfile && compatibility?.thinkingFormat) {
    return thinkingFieldsForFormat(
      resolved,
      reasoningEffort,
      modelProfile,
      compatibility,
      maxTokens,
    );
  }
  return {
    ...(options.thinking && resolved ? { thinking: { type: resolved } } : {}),
    ...(options.reasoningEffort
      && thinking !== "disabled"
      && (reasoningEffort === "minimal" || reasoningEffort === "high" || reasoningEffort === "max")
      ? { reasoning_effort: reasoningEffort }
      : {}),
  };
}

function thinkingFieldsForFormat(
  resolved: "enabled" | "disabled" | undefined,
  reasoningEffort: "off" | "minimal" | "high" | "max" | undefined,
  modelProfile: ProviderModelProfile,
  compatibility: ProviderCompatibility,
  maxTokens?: number,
): Record<string, unknown> {
  if (!resolved || resolved === "disabled" || reasoningEffort === "off") {
    if (compatibility.supportsThinkingDisable === false) {
      return { thinking: { type: "enabled" } };
    }
    const offLevel = modelProfile.thinkingLevelMap?.off ?? "none";
    switch (compatibility.thinkingFormat) {
      case "openai":
      case "reasoning_effort":
        return compatibility.supportsReasoningEffort === false
          ? {}
          : { reasoning_effort: offLevel };
      case "openrouter":
        return { reasoning: { effort: offLevel } };
      case "together":
      case "baseten":
        return { reasoning: { enabled: false } };
      case "qwen":
        return { enable_thinking: false };
      case "chat-template":
      case "qwen-chat-template":
        return {
          chat_template_kwargs: {
            ...(compatibility.chatTemplateKwargs ?? {}),
            enable_thinking: false,
          },
        };
      case "deepseek":
      case "zai":
        return { thinking: { type: "disabled" } };
      case "string-thinking":
        return { thinking: offLevel };
      case "ant-ling":
        return { reasoning: { effort: offLevel } };
      default:
        return {};
    }
  }
  const level = reasoningEffort === "max"
    ? "max"
    : reasoningEffort === "high"
      ? "high"
      : reasoningEffort === "minimal"
        ? "minimal"
        : "medium";
  const mapped = modelProfile.thinkingLevelMap?.[level];
  if (mapped === null) return {};
  const wireLevel = mapped ?? level;
  switch (compatibility.thinkingFormat) {
    case "openai":
    case "reasoning_effort":
      return compatibility.supportsReasoningEffort === false ? {} : { reasoning_effort: wireLevel };
    case "openrouter":
      return { reasoning: { effort: wireLevel } };
    case "together":
      return {
        reasoning: { enabled: true },
        ...(compatibility.supportsReasoningEffort === false ? {} : { reasoning_effort: wireLevel }),
      };
    case "baseten":
      return {
        reasoning: { enabled: true },
        ...(compatibility.supportsReasoningEffort === false ? {} : { reasoning_effort: wireLevel }),
      };
    case "qwen":
      return { enable_thinking: true };
    case "chat-template":
    case "qwen-chat-template":
      return {
        chat_template_kwargs: {
          ...(compatibility.chatTemplateKwargs ?? {}),
          enable_thinking: true,
        },
        ...(compatibility.thinkingFormat === "qwen-chat-template" ? { preserve_thinking: true } : {}),
      };
    case "deepseek":
    case "zai":
      return {
        thinking: { type: "enabled" },
        ...(compatibility.supportsReasoningEffort === false ? {} : { reasoning_effort: wireLevel }),
        ...thinkingBudgetField(compatibility, maxTokens),
      };
    case "string-thinking":
      return { thinking: wireLevel };
    case "ant-ling":
      return { reasoning: { effort: wireLevel } };
    case "none":
      return {};
    default:
      return {};
  }
}

function thinkingBudgetField(
  compatibility: ProviderCompatibility,
  maxTokens: number | undefined,
): Record<string, number> {
  if (!compatibility.thinkingTokenBudgetField) return {};
  const budget = Math.max(1024, Math.floor((maxTokens ?? DEFAULT_MAX_TOKENS) * 0.75));
  return { [compatibility.thinkingTokenBudgetField]: budget };
}

function maxTokenField(
  maxTokens: number,
  compatibility: ProviderCompatibility,
): Record<string, number> {
  const effectiveMaxTokens = Math.max(DEFAULT_MAX_TOKENS, maxTokens);
  return compatibility.maxTokensField === "max_completion_tokens"
    ? { max_completion_tokens: effectiveMaxTokens }
    : { max_tokens: effectiveMaxTokens };
}

function normalizeFinishReason(
  reason: string | null | undefined,
): ChatResponse["finishReason"] {
  if (!reason) return undefined;
  if (reason === "stop") return "stop";
  if (reason === "tool_calls" || reason === "function_call") return "tool_calls";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "content_filter";
  return "unknown";
}

function toolChoiceForThinkingMode(
  toolChoice: "auto" | "required" | "none" | undefined,
  options: OpenAIProviderOptions,
  thinking: "enabled" | "disabled" | undefined,
): "auto" | "required" | "none" | undefined {
  if (options.omitToolChoiceWhenThinking && thinking === "enabled") return undefined;
  if (toolChoice === "required" && options.toolChoice === "auto") return "auto";
  return toolChoice;
}

export function normalizeTokenUsage(
  usage: OpenAI.Completions.CompletionUsage | null | undefined,
  model?: string,
  provider = "openai-compatible",
): TokenUsage | undefined {
  if (!usage) return undefined;
  const cacheUsage = usage as OpenAI.Completions.CompletionUsage & {
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cacheHitInputTokens: cacheUsage.prompt_cache_hit_tokens,
    cacheMissInputTokens: cacheUsage.prompt_cache_miss_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    provider,
    model,
    protocol: "openai-chat",
  };
}

function normalizeToolCalls(
  calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): ToolCall[] {
  return calls
    ?.filter(isFunctionToolCall)
    .map((call) => ({
      id: call.id,
      type: "function",
      function: call.function,
    })) ?? [];
}

function isFunctionToolCall(
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  return call.type === "function";
}
