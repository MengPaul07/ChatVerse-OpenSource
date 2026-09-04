import type {
  ChatProvider,
  ChatResponse,
  LLMMessage,
  ProviderCapabilities,
  ProviderCompatibility,
  ProviderModelProfile,
  ProviderProfile,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "../../contracts/provider.js";
import {
  asRecord,
  createRequestSignal,
  reportUsage,
  sanitizeToolSchema,
  stringValue,
  wrapProviderError,
} from "./provider-utils.js";
import { resolveModelProfile } from "./model-profile.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 32_768;
const ANTHROPIC_SDK_MODULE = "@anthropic-ai/sdk";

type AnthropicSdkModule = typeof import("@anthropic-ai/sdk");

interface AnthropicMessagesApi {
  create(request: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

interface AnthropicProviderOptions {
  extendedThinking: boolean;
  thinkingBudgetTokens: number;
}

export interface AnthropicMessagesProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  providerName?: string;
  providerOptions?: Record<string, unknown>;
  modelProfile?: ProviderModelProfile;
  capabilities?: Partial<ProviderCapabilities>;
  contextWindow?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Anthropic Messages protocol driver. */
export function createAnthropicMessagesProvider(config: AnthropicMessagesProviderConfig): ChatProvider {
  const providerName = config.providerName ?? "anthropic";
  const model = config.model ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? DEFAULT_BASE_URL;
  const options = anthropicProviderOptions(config.providerOptions);
  const modelProfile = resolveModelProfile("anthropic-messages", model, config.modelProfile);
  const compatibility = modelProfile.compatibility ?? {};
  let messagesPromise: Promise<AnthropicMessagesApi> | undefined;
  const getMessages = (): Promise<AnthropicMessagesApi> => {
    messagesPromise ??= loadAnthropicMessages({
      apiKey: config.apiKey,
      baseURL,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
    return messagesPromise;
  };
  const profile = createProfile(config, providerName, model, baseURL, options, modelProfile, compatibility);

  return {
    async complete({ systemPrompt, userPrompt, maxTokens, responseFormat, thinking, reasoningEffort, signal, onUsage }) {
      const response = await requestMessage({
        messages: await getMessages(),
        model,
        providerName,
        systemPrompt,
        inputMessages: [{ role: "user", content: userPrompt }],
        maxTokens,
        responseFormat,
        thinking,
        reasoningEffort,
        options,
        timeoutMs: config.timeoutMs,
        signal,
        onUsage,
        modelProfile,
        compatibility,
      });
      return response.content ?? "";
    },

    async *stream({ systemPrompt, userPrompt, signal, onUsage }) {
      const request = createRequestSignal(signal, config.timeoutMs);
      try {
        const stream = await (await getMessages()).create(createMessageRequest({
          model,
          systemPrompt,
          inputMessages: [{ role: "user", content: userPrompt }],
          maxTokens: DEFAULT_MAX_TOKENS,
          options,
          modelProfile,
          compatibility,
          stream: true,
        }), { signal: request.signal });
        let usage: TokenUsage | undefined;
        for await (const event of asAsyncIterable(stream)) {
          const delta = textDelta(event);
          if (delta) yield delta;
          const eventUsageValue = eventUsage(event, model, providerName);
          if (eventUsageValue) usage = mergeUsage(usage, eventUsageValue);
        }
        reportUsage(onUsage, usage);
      } catch (error) {
        throw wrapProviderError(request.wrapError(error), {
          protocol: "anthropic-messages",
          provider: providerName,
          model,
        });
      } finally {
        request.cleanup();
      }
    },

    async chat({
      messages: inputMessages,
      tools,
      toolChoice,
      thinking,
      reasoningEffort,
      maxTokens,
      stream,
      signal,
      onUsage,
      onTextDelta,
    }) {
      return requestMessage({
        messages: await getMessages(),
        model,
        providerName,
        inputMessages,
        tools,
        toolChoice,
        thinking,
        reasoningEffort,
        options,
        maxTokens,
        timeoutMs: config.timeoutMs,
        signal,
        onUsage,
        modelProfile,
        compatibility,
        stream,
        onTextDelta,
      });
    },
    profile,
  };
}

async function loadAnthropicMessages(config: {
  apiKey: string;
  baseURL: string;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<AnthropicMessagesApi> {
  // Keep the server-only SDK out of browser bundles. The dynamic import is
  // reached only after a server request selects the Anthropic protocol.
  const sdk = await import(/* @vite-ignore */ ANTHROPIC_SDK_MODULE) as AnthropicSdkModule;
  const client = new sdk.default({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    ...(config.timeoutMs === undefined ? {} : { timeout: config.timeoutMs }),
    ...(config.maxRetries === undefined ? {} : { maxRetries: config.maxRetries }),
  });
  return client.messages as unknown as AnthropicMessagesApi;
}

function anthropicProviderOptions(value: Record<string, unknown> | undefined): AnthropicProviderOptions {
  const root = asRecord(value?.anthropic) ?? {};
  const configuredBudget = numberValue(root.thinkingBudgetTokens);
  return {
    extendedThinking: root.extendedThinking === true || root.thinking === true,
    thinkingBudgetTokens: configuredBudget && configuredBudget >= 1024
      ? Math.floor(configuredBudget)
      : 2048,
  };
}

async function requestMessage(input: {
  messages: AnthropicMessagesApi;
  model: string;
  providerName: string;
  systemPrompt?: string;
  inputMessages: LLMMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "off" | "minimal" | "high" | "max";
  options: AnthropicProviderOptions;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
  timeoutMs?: number;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
  modelProfile: ProviderModelProfile;
  compatibility: ProviderCompatibility;
  onTextDelta?: (delta: string) => void;
  stream?: boolean;
}): Promise<ChatResponse> {
  const request = createRequestSignal(input.signal, input.timeoutMs);
  try {
    const requestBody = createMessageRequest(input);
    if (input.stream || input.onTextDelta) {
      requestBody.stream = true;
      return await streamMessage({
        ...input,
        signal: request.signal,
        requestBody,
        onProgress: request.touch,
      });
    }
    const response = await input.messages.create(requestBody, { signal: request.signal });
    const normalized = normalizeMessage(response, input.model, input.providerName);
    reportUsage(input.onUsage, normalized.usage);
    return normalized;
  } catch (error) {
    throw wrapProviderError(request.wrapError(error), {
      protocol: "anthropic-messages",
      provider: input.providerName,
      model: input.model,
    });
  } finally {
    request.cleanup();
  }
}

async function streamMessage(input: {
  messages: AnthropicMessagesApi;
  model: string;
  providerName: string;
  options: AnthropicProviderOptions;
  requestBody: Record<string, unknown>;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
  onTextDelta?: (delta: string) => void;
  onProgress?: () => void;
}): Promise<ChatResponse> {
  const stream = await input.messages.create(input.requestBody, { signal: input.signal });
  let content = "";
  let reasoningContent = "";
  let usage: TokenUsage | undefined;
  let finishReason: ChatResponse["finishReason"];
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const event of asAsyncIterable(stream)) {
    input.onProgress?.();
    const delta = textDelta(event);
    if (delta) {
      content += delta;
      try {
        input.onTextDelta?.(delta);
      } catch {
        // Streaming observers cannot interrupt a successful provider request.
      }
    }
    const reasoning = thinkingDelta(event);
    if (reasoning) reasoningContent += reasoning;
    collectToolDelta(calls, event);
    const eventUsageValue = eventUsage(event, input.model, input.providerName);
    if (eventUsageValue) usage = mergeUsage(usage, eventUsageValue);
    const reason = stopReason(event);
    if (reason) finishReason = reason;
  }
  const toolCalls = normalizeCalls(calls);
  if (toolCalls.length > 0) finishReason = "tool_calls";
  reportUsage(input.onUsage, usage);
  return {
    content: content || null,
    reasoningContent: reasoningContent || undefined,
    toolCalls,
    finishReason,
    usage,
  };
}

function createMessageRequest(input: {
  model: string;
  systemPrompt?: string;
  inputMessages: LLMMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "off" | "minimal" | "high" | "max";
  options: AnthropicProviderOptions;
  maxTokens?: number;
  modelProfile: ProviderModelProfile;
  compatibility: ProviderCompatibility;
  stream?: boolean;
}): Record<string, unknown> {
  const systemMessages = input.inputMessages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  const system = [input.systemPrompt, ...systemMessages].filter(Boolean).join("\n\n");
  const request: Record<string, unknown> = {
    model: input.model,
    max_tokens: Math.max(DEFAULT_MAX_TOKENS, input.maxTokens ?? DEFAULT_MAX_TOKENS),
    messages: toAnthropicMessages(input.inputMessages),
    ...(system ? { system } : {}),
    ...(input.tools?.length && input.compatibility.supportsTools !== false
      ? { tools: toAnthropicTools(input.tools, input.compatibility) }
      : {}),
    ...(input.toolChoice && input.toolChoice !== "none" && input.compatibility.supportsTools !== false
      ? { tool_choice: toAnthropicToolChoice(input.toolChoice) }
      : {}),
    ...(input.stream ? { stream: true } : {}),
  };
  const thinking = toAnthropicThinking(
    input.thinking,
    input.reasoningEffort,
    input.options,
    input.maxTokens,
    input.modelProfile,
  );
  if (thinking) request.thinking = thinking;
  return request;
}

function toAnthropicMessages(messages: LLMMessage[]): unknown[] {
  const result: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      appendMessage(result, "user", [{
        type: "tool_result",
        tool_use_id: message.tool_call_id ?? "unknown-tool-call",
        content: message.content,
      }]);
      continue;
    }
    if (message.role === "user") {
      appendMessage(result, "user", message.content);
      continue;
    }
    const blocks: unknown[] = [];
    if (message.content) blocks.push({ type: "text", text: message.content });
    for (const call of message.tool_calls ?? []) {
      blocks.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: parseJsonObject(call.function.arguments),
      });
    }
    appendMessage(result, "assistant", blocks.length > 0 ? blocks : message.content || "");
  }
  return result;
}

function appendMessage(
  messages: Array<{ role: "user" | "assistant"; content: unknown }>,
  role: "user" | "assistant",
  content: unknown,
): void {
  const previous = messages.at(-1);
  if (!previous || previous.role !== role) {
    messages.push({ role, content });
    return;
  }
  const previousBlocks = Array.isArray(previous.content)
    ? previous.content
    : [{ type: "text", text: String(previous.content) }];
  const nextBlocks = Array.isArray(content)
    ? content
    : [{ type: "text", text: String(content) }];
  previous.content = [...previousBlocks, ...nextBlocks];
}

function toAnthropicTools(tools: ToolDefinition[], compatibility: ProviderCompatibility): unknown[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: sanitizeToolSchema(tool.function.parameters, compatibility),
  }));
}

function toAnthropicToolChoice(choice: "auto" | "required"): unknown {
  if (choice === "required") return { type: "any" };
  return { type: "auto" };
}

function toAnthropicThinking(
  thinking: "enabled" | "disabled" | undefined,
  effort: "off" | "minimal" | "high" | "max" | undefined,
  options: AnthropicProviderOptions,
  maxTokens: number | undefined,
  modelProfile: ProviderModelProfile,
): Record<string, unknown> | undefined {
  if ((!modelProfile.reasoning && modelProfile.compatibility?.thinkingFormat === "none")
    || !options.extendedThinking
    || thinking === "disabled"
    || effort === "off") return undefined;
  if (thinking !== "enabled" && effort !== "minimal" && effort !== "high" && effort !== "max") return undefined;
  const max = maxTokens ?? DEFAULT_MAX_TOKENS;
  const budget = Math.min(options.thinkingBudgetTokens, Math.max(1024, max - 1));
  return { type: "enabled", budget_tokens: budget };
}

function normalizeMessage(value: unknown, model: string, providerName: string): ChatResponse {
  const response = asRecord(value);
  const blocks = Array.isArray(response?.content) ? response.content : [];
  const text: string[] = [];
  const reasoning: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of blocks) {
    const record = asRecord(block);
    if (record?.type === "text" && typeof record.text === "string") text.push(record.text);
    if (record?.type === "thinking" && typeof record.thinking === "string") reasoning.push(record.thinking);
    if (record?.type === "tool_use") {
      toolCalls.push({
        id: stringValue(record.id) ?? `anthropic-tool-${toolCalls.length + 1}`,
        type: "function",
        function: {
          name: stringValue(record.name) ?? "",
          arguments: JSON.stringify(record.input ?? {}),
        },
      });
    }
  }
  const stop = stringValue(response?.stop_reason);
  return {
    content: text.join("") || null,
    reasoningContent: reasoning.join("") || undefined,
    toolCalls,
    finishReason: toolCalls.length > 0
      ? "tool_calls"
      : stop === "max_tokens" ? "max_tokens"
        : stop === "end_turn" || stop === "stop_sequence" ? "stop" : "unknown",
    usage: normalizeUsage(response?.usage, model, providerName),
  };
}

function textDelta(value: unknown): string | undefined {
  const delta = asRecord(asRecord(value)?.delta);
  return delta?.type === "text_delta" && typeof delta.text === "string" ? delta.text : undefined;
}

function thinkingDelta(value: unknown): string | undefined {
  const delta = asRecord(asRecord(value)?.delta);
  return delta?.type === "thinking_delta" && typeof delta.thinking === "string"
    ? delta.thinking
    : undefined;
}

function collectToolDelta(
  calls: Map<number, { id: string; name: string; arguments: string }>,
  value: unknown,
): void {
  const record = asRecord(value);
  const index = numberValue(record?.index);
  if (index === undefined) return;
  if (record?.type === "content_block_start") {
    const block = asRecord(record.content_block);
    if (block?.type !== "tool_use") return;
    const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
    call.id = stringValue(block.id) ?? call.id;
    call.name = stringValue(block.name) ?? call.name;
    calls.set(index, call);
    return;
  }
  const delta = asRecord(record?.delta);
  if (delta?.type !== "input_json_delta" || typeof delta.partial_json !== "string") return;
  const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
  call.arguments += delta.partial_json;
  calls.set(index, call);
}

function stopReason(value: unknown): ChatResponse["finishReason"] | undefined {
  const record = asRecord(value);
  const delta = asRecord(record?.delta);
  const stop = stringValue(delta?.stop_reason);
  if (record?.type !== "message_delta" || !stop) return undefined;
  if (stop === "max_tokens") return "max_tokens";
  if (stop === "end_turn" || stop === "stop_sequence") return "stop";
  return "unknown";
}

function eventUsage(value: unknown, model: string, providerName: string): TokenUsage | undefined {
  const record = asRecord(value);
  const usage = record?.type === "message_start"
    ? asRecord(asRecord(record.message)?.usage)
    : record?.type === "message_delta" ? asRecord(record.usage) : undefined;
  return normalizeUsage(usage, model, providerName);
}

function normalizeUsage(value: unknown, model: string, providerName: string): TokenUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const normalizedInputTokens = inputTokens ?? 0;
  const normalizedOutputTokens = outputTokens ?? 0;
  return {
    inputTokens: normalizedInputTokens,
    outputTokens: normalizedOutputTokens,
    totalTokens: numberValue(usage.total_tokens) ?? normalizedInputTokens + normalizedOutputTokens,
    cacheHitInputTokens: numberValue(usage.cache_read_input_tokens),
    cacheMissInputTokens: numberValue(usage.cache_creation_input_tokens),
    provider: providerName,
    model,
    protocol: "anthropic-messages",
  };
}

function mergeUsage(previous: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  if (!previous) return next;
  const inputTokens = Math.max(previous.inputTokens, next.inputTokens);
  const outputTokens = Math.max(previous.outputTokens, next.outputTokens);
  return {
    ...next,
    inputTokens,
    outputTokens,
    totalTokens: Math.max(next.totalTokens, inputTokens + outputTokens),
    cacheHitInputTokens: maxDefined(previous.cacheHitInputTokens, next.cacheHitInputTokens),
    cacheMissInputTokens: maxDefined(previous.cacheMissInputTokens, next.cacheMissInputTokens),
  };
}

function maxDefined(first: number | undefined, second: number | undefined): number | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return Math.max(first, second);
}

function normalizeCalls(calls: Map<number, { id: string; name: string; arguments: string }>): ToolCall[] {
  return [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call], index) => ({
      id: call.id || `anthropic-stream-tool-${index + 1}`,
      type: "function",
      function: { name: call.name, arguments: call.arguments || "{}" },
    }));
}

async function* asAsyncIterable(value: unknown): AsyncIterable<unknown> {
  if (!value || typeof value !== "object" || !(Symbol.asyncIterator in value)) return;
  for await (const item of value as AsyncIterable<unknown>) yield item;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function createProfile(
  config: AnthropicMessagesProviderConfig,
  providerName: string,
  model: string,
  baseURL: string,
  options: AnthropicProviderOptions,
  modelProfile: ProviderModelProfile,
  compatibility: ProviderCompatibility,
): ProviderProfile {
  const capabilities: ProviderCapabilities = {
    stream: true,
    tools: compatibility.supportsTools !== false,
    json: "prompt",
    reasoning: (modelProfile.reasoning || compatibility.thinkingFormat === undefined)
      && options.extendedThinking
      ? "option"
      : "none",
    webSearch: false,
    vision: modelProfile.input.includes("image"),
    toolChoice: "required",
    ...config.capabilities,
  };
  return {
    protocol: "anthropic-messages",
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
