import OpenAI from "openai";
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
import type { OpenAIChatProviderConfig } from "./openai-compatible.js";
import {
  asRecord,
  createRequestSignal,
  reportUsage,
  sanitizeToolSchema,
  stringValue,
  wrapProviderError,
} from "./provider-utils.js";
import { resolveModelProfile } from "./model-profile.js";

export const OPENAI_RESPONSES_DEFAULT_MODEL = "gpt-4o-mini";
export const OPENAI_RESPONSES_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_RESPONSES_DEFAULT_MAX_TOKENS = 32_768;

export interface OpenAIResponsesApi {
  create<T = unknown>(request: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<T>;
}

/** Shared SDK transport for runtime Responses and web research. */
export function createOpenAIResponsesApi(
  config: Pick<OpenAIChatProviderConfig, "apiKey" | "baseURL" | "timeoutMs" | "maxRetries">,
): OpenAIResponsesApi {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL ?? OPENAI_RESPONSES_DEFAULT_BASE_URL,
    ...(config.timeoutMs === undefined ? {} : { timeout: config.timeoutMs }),
    ...(config.maxRetries === undefined ? {} : { maxRetries: config.maxRetries }),
  });
  return client.responses as unknown as OpenAIResponsesApi;
}

/** OpenAI Responses protocol driver for stateless text and tool requests. */
export function createOpenAIResponsesProvider(config: OpenAIChatProviderConfig): ChatProvider {
  const providerName = config.providerName ?? "openai-compatible";
  const model = config.model ?? OPENAI_RESPONSES_DEFAULT_MODEL;
  const baseURL = config.baseURL ?? OPENAI_RESPONSES_DEFAULT_BASE_URL;
  const responses = createOpenAIResponsesApi(config);
  const modelProfile = resolveModelProfile("openai-responses", model, config.modelProfile);
  const compatibility = modelProfile.compatibility ?? {};
  const profile = createProfile(config, providerName, model, baseURL, modelProfile, compatibility);

  return {
    async complete({ systemPrompt, userPrompt, maxTokens, responseFormat, thinking, reasoningEffort, signal, onUsage }) {
      const response = await requestResponse({
        responses,
        model,
        providerName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        maxTokens,
        responseFormat,
        thinking,
        reasoningEffort,
        signal,
        timeoutMs: config.timeoutMs,
        modelProfile,
        compatibility,
        onUsage,
      });
      return response.content ?? "";
    },

    async *stream({ systemPrompt, userPrompt, signal, onUsage }) {
      const request = createRequestSignal(signal, config.timeoutMs);
      try {
        const stream = await responses.create(createResponseRequest({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          maxTokens: OPENAI_RESPONSES_DEFAULT_MAX_TOKENS,
          modelProfile,
          compatibility,
          stream: true,
        }), { signal: request.signal });
        let usage: TokenUsage | undefined;
        for await (const event of asAsyncIterable(stream)) {
          const delta = responseTextDelta(event);
          if (delta) yield delta;
          const eventUsage = responseEventUsage(event, model, providerName);
          if (eventUsage) usage = eventUsage;
        }
        reportUsage(onUsage, usage);
      } catch (error) {
        throw wrapProviderError(request.wrapError(error), {
          protocol: "openai-responses",
          provider: providerName,
          model,
        });
      } finally {
        request.cleanup();
      }
    },

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
    }) {
      return requestResponse({
        responses,
        model,
        providerName,
        messages,
        tools,
        toolChoice,
        thinking,
        reasoningEffort,
        maxTokens,
        signal,
        timeoutMs: config.timeoutMs,
        modelProfile,
        compatibility,
        stream,
        onUsage,
        onTextDelta,
      });
    },
    profile,
  };
}

async function requestResponse(input: {
  responses: OpenAIResponsesApi;
  model: string;
  providerName: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "off" | "minimal" | "high" | "max";
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
  signal?: AbortSignal;
  timeoutMs?: number;
  modelProfile: ProviderModelProfile;
  compatibility: ProviderCompatibility;
  onUsage?: (usage: TokenUsage) => void;
  onTextDelta?: (delta: string) => void;
  stream?: boolean;
  onProgress?: () => void;
}): Promise<ChatResponse> {
  const request = createRequestSignal(input.signal, input.timeoutMs);
  try {
    if (input.stream || input.onTextDelta) {
      return await streamResponse({ ...input, signal: request.signal, onProgress: request.touch });
    }
    const response = await input.responses.create(createResponseRequest({
      model: input.model,
      messages: input.messages,
      tools: input.tools,
      toolChoice: input.toolChoice,
      thinking: input.thinking,
      reasoningEffort: input.reasoningEffort,
      maxTokens: input.maxTokens,
      responseFormat: input.responseFormat,
      modelProfile: input.modelProfile,
      compatibility: input.compatibility,
    }), { signal: request.signal });
    const normalized = normalizeResponse(response, input.model, input.providerName);
    reportUsage(input.onUsage, normalized.usage);
    return normalized;
  } catch (error) {
    throw wrapProviderError(request.wrapError(error), {
      protocol: "openai-responses",
      provider: input.providerName,
      model: input.model,
    });
  } finally {
    request.cleanup();
  }
}

async function streamResponse(input: Parameters<typeof requestResponse>[0]): Promise<ChatResponse> {
  const stream = await input.responses.create(createResponseRequest({
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    toolChoice: input.toolChoice,
    thinking: input.thinking,
    reasoningEffort: input.reasoningEffort,
    maxTokens: input.maxTokens,
    responseFormat: input.responseFormat,
    modelProfile: input.modelProfile,
    compatibility: input.compatibility,
    stream: true,
  }), { signal: input.signal });
  let content = "";
  let reasoningContent = "";
  let usage: TokenUsage | undefined;
  const calls = new Map<string, { id: string; name: string; arguments: string }>();
  let finishReason: ChatResponse["finishReason"];

  for await (const event of asAsyncIterable(stream)) {
    input.onProgress?.();
    const delta = responseTextDelta(event);
    if (delta) {
      content += delta;
      try {
        input.onTextDelta?.(delta);
      } catch {
        // Streaming observers cannot interrupt a successful provider request.
      }
    }
    const reasoning = responseReasoningDelta(event);
    if (reasoning) reasoningContent += reasoning;
    collectResponseToolDelta(calls, event);
    const eventUsage = responseEventUsage(event, input.model, input.providerName);
    if (eventUsage) usage = eventUsage;
    const eventFinishReason = responseEventFinishReason(event);
    if (eventFinishReason) finishReason = eventFinishReason;
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

function createResponseRequest(input: {
  model: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "off" | "minimal" | "high" | "max";
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
  modelProfile: ProviderModelProfile;
  compatibility: ProviderCompatibility;
  stream?: boolean;
}): Record<string, unknown> {
  const { instructions, input: responseInput } = toResponseInput(input.messages);
  const request: Record<string, unknown> = {
    model: input.model,
    input: responseInput,
    ...(instructions ? { instructions } : {}),
    ...(input.tools?.length && input.compatibility.supportsTools !== false
      ? { tools: toResponseTools(input.tools, input.compatibility) }
      : {}),
    ...(input.toolChoice && input.compatibility.supportsTools !== false
      ? { tool_choice: input.toolChoice }
      : {}),
    max_output_tokens: Math.max(
      OPENAI_RESPONSES_DEFAULT_MAX_TOKENS,
      input.maxTokens ?? OPENAI_RESPONSES_DEFAULT_MAX_TOKENS,
    ),
    ...(input.stream ? { stream: true } : {}),
    ...(input.modelProfile.samplingParams ?? {}),
  };
  if (input.responseFormat) {
    request.text = { format: input.responseFormat };
  }
  const reasoning = (input.modelProfile.reasoning || input.compatibility.thinkingFormat === undefined)
    && input.compatibility.thinkingFormat !== "none"
    ? toResponseReasoning(input.thinking, input.reasoningEffort)
    : undefined;
  if (reasoning) request.reasoning = reasoning;
  return request;
}

function toResponseInput(messages: LLMMessage[]): { instructions: string; input: unknown[] } {
  const instructions: string[] = [];
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      instructions.push(message.content);
      continue;
    }
    if (message.role === "user") {
      input.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id ?? "unknown-tool-call",
        output: message.content,
      });
      continue;
    }
    if (message.content) input.push({ role: "assistant", content: message.content });
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  return { instructions: instructions.join("\n\n"), input };
}

function toResponseTools(tools: ToolDefinition[], compatibility: ProviderCompatibility): unknown[] {
  return tools.map((tool) => {
    const { strict, ...definition } = tool.function;
    return {
      type: "function",
      name: definition.name,
      description: definition.description,
      parameters: sanitizeToolSchema(definition.parameters, compatibility),
      ...(strict && compatibility.supportsStrictTools !== false ? { strict: true } : {}),
    };
  });
}

function toResponseReasoning(
  thinking: "enabled" | "disabled" | undefined,
  effort: "off" | "minimal" | "high" | "max" | undefined,
): Record<string, unknown> | undefined {
  if (thinking === "disabled" || effort === "off") return undefined;
  if (thinking !== "enabled" && effort !== "minimal" && effort !== "high" && effort !== "max") return undefined;
  return { effort: effort === "max" ? "high" : effort === "minimal" ? "low" : effort ?? "high" };
}

function normalizeResponse(value: unknown, model: string, providerName: string): ChatResponse {
  const response = asRecord(value);
  const output = Array.isArray(response?.output) ? response.output : [];
  let reasoningContent = "";
  const calls: ToolCall[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (record?.type === "function_call") {
      const id = stringValue(record.call_id) || stringValue(record.id) || `response-tool-${calls.length + 1}`;
      calls.push({
        id,
        type: "function",
        function: {
          name: stringValue(record.name) ?? "",
          arguments: typeof record.arguments === "string"
            ? record.arguments
            : JSON.stringify(record.arguments ?? {}),
        },
      });
    }
    if (record?.type === "reasoning") reasoningContent += reasoningText(record);
  }
  const status = stringValue(response?.status);
  return {
    content: stringValue(response?.output_text) ?? responseTextFromOutput(output),
    reasoningContent: reasoningContent || undefined,
    toolCalls: calls,
    finishReason: calls.length > 0
      ? "tool_calls"
      : status === "incomplete" ? "max_tokens" : status === "failed" ? "unknown" : "stop",
    usage: normalizeResponsesUsage(response?.usage, model, providerName),
  };
}

function responseTextFromOutput(output: unknown[]): string | null {
  const text: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    const content = Array.isArray(record?.content) ? record.content : [];
    for (const part of content) {
      const partRecord = asRecord(part);
      if (partRecord?.type === "output_text" && typeof partRecord.text === "string") text.push(partRecord.text);
    }
  }
  return text.join("") || null;
}

function reasoningText(record: Record<string, unknown>): string {
  const summary = Array.isArray(record.summary) ? record.summary : [];
  return summary.map((item) => stringValue(asRecord(item)?.text) ?? "").join("");
}

export function normalizeResponsesUsage(
  value: unknown,
  model: string,
  providerName: string,
): TokenUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const totalTokens = numberValue(usage.total_tokens) ?? inputTokens + outputTokens;
  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheHitInputTokens: numberValue(inputDetails?.cached_tokens),
    reasoningTokens: numberValue(outputDetails?.reasoning_tokens),
    provider: providerName,
    model,
    protocol: "openai-responses",
  };
}

function responseEventUsage(value: unknown, model: string, providerName: string): TokenUsage | undefined {
  const record = asRecord(value);
  return normalizeResponsesUsage(
    record?.response ? asRecord(record.response)?.usage : record?.usage,
    model,
    providerName,
  );
}

function responseTextDelta(value: unknown): string | undefined {
  const record = asRecord(value);
  return record?.type === "response.output_text.delta" && typeof record.delta === "string"
    ? record.delta
    : undefined;
}

function responseReasoningDelta(value: unknown): string | undefined {
  const record = asRecord(value);
  return record?.type === "response.reasoning_summary_text.delta" && typeof record.delta === "string"
    ? record.delta
    : undefined;
}

function collectResponseToolDelta(
  calls: Map<string, { id: string; name: string; arguments: string }>,
  value: unknown,
): void {
  const record = asRecord(value);
  if (record?.type === "response.output_item.added" || record?.type === "response.output_item.done") {
    const item = asRecord(record.item);
    if (item?.type !== "function_call") return;
    const callId = stringValue(item.call_id) ?? stringValue(item.id) ?? `response-tool-${calls.size + 1}`;
    const call = calls.get(callId) ?? { id: callId, name: "", arguments: "" };
    call.name = stringValue(item.name) ?? call.name;
    if (typeof item.arguments === "string") call.arguments = item.arguments;
    calls.set(callId, call);
    return;
  }
  if (record?.type !== "response.function_call_arguments.delta"
    && record?.type !== "response.function_call_arguments.done") return;
  const callId = stringValue(record.call_id) ?? stringValue(record.item_id) ?? "response-tool-1";
  const call = calls.get(callId) ?? { id: callId, name: "", arguments: "" };
  if (record.type === "response.function_call_arguments.delta" && typeof record.delta === "string") {
    call.arguments += record.delta;
  }
  if (record.type === "response.function_call_arguments.done" && typeof record.arguments === "string") {
    call.arguments = record.arguments;
  }
  calls.set(callId, call);
}

function responseEventFinishReason(value: unknown): ChatResponse["finishReason"] | undefined {
  const record = asRecord(value);
  if (record?.type !== "response.completed" && record?.type !== "response.done") return undefined;
  const response = asRecord(record.response);
  const status = stringValue(response?.status) ?? stringValue(record.status);
  return status === "incomplete" ? "max_tokens" : status === "failed" ? "unknown" : "stop";
}

function normalizeCalls(calls: Map<string, { id: string; name: string; arguments: string }>): ToolCall[] {
  return [...calls.values()].map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: call.arguments },
  }));
}

async function* asAsyncIterable(value: unknown): AsyncIterable<unknown> {
  if (!value || typeof value !== "object" || !(Symbol.asyncIterator in value)) return;
  for await (const item of value as AsyncIterable<unknown>) yield item;
}

function createProfile(
  config: OpenAIChatProviderConfig,
  providerName: string,
  model: string,
  baseURL: string,
  modelProfile: ProviderModelProfile,
  compatibility: ProviderCompatibility,
): ProviderProfile {
  const capabilities: ProviderCapabilities = {
    stream: true,
    tools: compatibility.supportsTools !== false,
    json: "native",
    reasoning: modelProfile.reasoning ? "native" : "none",
    webSearch: true,
    vision: modelProfile.input.includes("image"),
    toolChoice: "required",
    ...config.capabilities,
  };
  return {
    protocol: "openai-responses",
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
