import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createAnthropicMessagesProvider,
  createOpenAIChatProvider,
  createOpenAIResponsesProvider,
  createWebResearchProvider,
  isProviderProtocol,
  isWebResearchProtocol,
  PROVIDER_PROTOCOLS,
  type ChatProvider,
  type ProviderModelProfile,
  type WebResearchProviderConfig,
  type WorldDebugConfig,
} from "@chatverse/core";
import type { ProviderProtocol } from "@chatverse/core";
import { HttpError } from "./http/errors.js";
import type { ProviderRequestConfig } from "./provider-config.js";
import type { WorldDebugLogEntry } from "./rooms/room.js";
import type { ProviderPair } from "./rooms/contracts.js";

const DEFAULT_PROVIDER_TIMEOUT_MS = 90_000;

export const PROVIDER_NOT_CONFIGURED_MESSAGE = "当前没有可用的模型连接，请在设置中填写协议、API 地址、模型和 Key。";

export async function createEnvironmentProviders(config: ProviderRequestConfig = {}): Promise<ProviderPair> {
  const protocol = resolveProtocol(config.protocol);
  const source = resolveProviderSource(config, protocol);
  const apiKey = resolveApiKey(config.apiKey, protocol, source);
  if (!apiKey) {
    throw new HttpError(503, "provider_not_configured", PROVIDER_NOT_CONFIGURED_MESSAGE);
  }
  const baseURL = resolveBaseURL(config.baseURL, protocol, source);
  const providerName = config.providerName?.trim()
    || process.env.CHATVERSE_PROVIDER_NAME?.trim()
    || defaultProviderName(protocol);
  const sharedModel = resolveSharedModel(config.model, protocol, source);
  const providerOptions = config.providerOptions ?? readProviderOptionsFromEnvironment();
  const modelProfile = config.modelProfile;
  const directorModel = config.directorModel?.trim() || process.env.DIRECTOR_MODEL?.trim() || sharedModel;
  const characterModel = config.characterModel?.trim() || process.env.CHARACTER_MODEL?.trim() || sharedModel;
  const authoringModel = config.authoringModel?.trim()
    || process.env.AUTHORING_MODEL?.trim()
    || process.env.DIRECTOR_MODEL?.trim()
    || sharedModel
    || undefined;
  const timeoutMs = configuredProviderTimeoutMs();
  const [directorProvider, characterProvider, authoringProvider] = await Promise.all([
    createConfiguredProvider({
      protocol,
      apiKey,
      baseURL,
      providerName,
      providerOptions,
      modelProfile: profileForModel(modelProfile, directorModel),
      model: directorModel,
      timeoutMs,
      maxRetries: 0,
    }),
    createConfiguredProvider({
      protocol,
      apiKey,
      baseURL,
      providerName,
      providerOptions,
      modelProfile: profileForModel(modelProfile, characterModel),
      model: characterModel,
      timeoutMs,
      maxRetries: 0,
    }),
    createConfiguredProvider({
      protocol,
      apiKey,
      baseURL,
      providerName,
      providerOptions,
      modelProfile: profileForModel(modelProfile, authoringModel),
      model: authoringModel,
      timeoutMs,
      maxRetries: 0,
    }),
  ]);
  const researchConfig = resolveResearchConfiguration(config.research, timeoutMs);
  const researchProvider = researchConfig
    ? createWebResearchProvider(researchConfig)
    : undefined;
  return { directorProvider, characterProvider, authoringProvider, researchProvider };
}

function createConfiguredProvider(input: {
  protocol: ProviderProtocol;
  apiKey: string;
  baseURL?: string;
  providerName: string;
  providerOptions?: Record<string, unknown>;
  modelProfile?: ProviderModelProfile;
  model?: string;
  timeoutMs: number;
  maxRetries: number;
}): ChatProvider {
  const common = {
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    providerName: input.providerName,
    providerOptions: input.providerOptions,
    modelProfile: input.modelProfile,
    model: input.model,
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
  };
  switch (input.protocol) {
    case "openai-chat":
      return createOpenAIChatProvider(common);
    case "openai-responses":
      return createOpenAIResponsesProvider(common);
    case "anthropic-messages":
      return createAnthropicMessagesProvider(common);
  }
  throw new Error(`Unsupported provider protocol: ${input.protocol}`);
}

function profileForModel(
  profile: ProviderModelProfile | undefined,
  model: string | undefined,
): ProviderModelProfile | undefined {
  return profile && model && profile.id === model ? profile : undefined;
}

function resolveResearchConfiguration(
  request: ProviderRequestConfig["research"],
  timeoutMs: number,
): WebResearchProviderConfig | undefined {
  const rawProtocol = request?.protocol ?? process.env.CHATVERSE_RESEARCH_PROTOCOL?.trim();
  if (!rawProtocol) return undefined;
  if (!isWebResearchProtocol(rawProtocol)) {
    throw new HttpError(500, "invalid_provider_config", "CHATVERSE_RESEARCH_PROTOCOL 配置无效。 ");
  }
  const apiKey = request?.apiKey?.trim() || process.env.CHATVERSE_RESEARCH_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(503, "research_provider_not_configured", "联网检索需要独立的 API Key。 ");
  }
  return {
    protocol: rawProtocol,
    apiKey,
    baseURL: request?.baseURL?.trim() || process.env.CHATVERSE_RESEARCH_BASE_URL?.trim(),
    providerName: request?.providerName?.trim() || process.env.CHATVERSE_RESEARCH_PROVIDER_NAME?.trim(),
    model: request?.model?.trim() || process.env.CHATVERSE_RESEARCH_MODEL?.trim(),
    options: request?.options ?? readResearchOptionsFromEnvironment(),
    timeoutMs,
    maxRetries: 0,
  };
}

function resolveProtocol(value: ProviderProtocol | undefined): ProviderProtocol {
  const configured = value ?? process.env.CHATVERSE_PROVIDER_PROTOCOL?.trim();
  if (!configured) return "openai-chat";
  if (isProviderProtocol(configured)) return configured;
  throw new HttpError(
    500,
    "invalid_provider_config",
    `CHATVERSE_PROVIDER_PROTOCOL 配置无效，支持：${PROVIDER_PROTOCOLS.join("、")}。 `,
  );
}

type ProviderSource = "request" | "generic" | "openai" | "deepseek" | "anthropic" | "default";

function resolveProviderSource(config: ProviderRequestConfig, protocol: ProviderProtocol): ProviderSource {
  if (config.apiKey?.trim()) return "request";
  if (process.env.CHATVERSE_API_KEY?.trim()) return "generic";
  if (protocol === "anthropic-messages") return process.env.ANTHROPIC_API_KEY?.trim() ? "anthropic" : "default";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
  return "default";
}

function resolveApiKey(
  requestKey: string | undefined,
  protocol: ProviderProtocol,
  source: ProviderSource,
): string | undefined {
  if (source === "request") return requestKey?.trim();
  if (source === "generic") return process.env.CHATVERSE_API_KEY?.trim();
  if (source === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim();
  if (source === "openai") return process.env.OPENAI_API_KEY?.trim();
  if (source === "deepseek") return process.env.DEEPSEEK_API_KEY?.trim();
  return protocol === "anthropic-messages"
    ? process.env.ANTHROPIC_API_KEY?.trim()
    : process.env.OPENAI_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
}

function resolveBaseURL(
  requestURL: string | undefined,
  protocol: ProviderProtocol,
  source: ProviderSource,
): string | undefined {
  if (requestURL?.trim()) return requestURL.trim();
  if (source === "generic") return process.env.CHATVERSE_BASE_URL?.trim() || defaultBaseURL(protocol);
  if (source === "anthropic") return process.env.ANTHROPIC_BASE_URL?.trim() || defaultBaseURL(protocol);
  if (source === "openai") return process.env.OPENAI_BASE_URL?.trim() || defaultBaseURL(protocol);
  if (source === "deepseek") return process.env.DEEPSEEK_BASE_URL?.trim() || defaultBaseURL(protocol);
  return process.env.CHATVERSE_BASE_URL?.trim()
    || (protocol === "anthropic-messages"
      ? process.env.ANTHROPIC_BASE_URL?.trim()
      : process.env.OPENAI_BASE_URL?.trim() || process.env.DEEPSEEK_BASE_URL?.trim())
    || undefined;
}

function resolveSharedModel(
  requestModel: string | undefined,
  protocol: ProviderProtocol,
  source: ProviderSource,
): string | undefined {
  if (requestModel?.trim()) return requestModel.trim();
  if (source === "generic") return process.env.CHATVERSE_MODEL?.trim() || undefined;
  if (source === "anthropic") return process.env.ANTHROPIC_MODEL?.trim() || undefined;
  if (source === "openai") return process.env.OPENAI_MODEL?.trim() || undefined;
  if (source === "deepseek") return process.env.DEEPSEEK_MODEL?.trim() || undefined;
  return process.env.CHATVERSE_MODEL?.trim()
    || (protocol === "anthropic-messages"
      ? process.env.ANTHROPIC_MODEL?.trim()
      : process.env.OPENAI_MODEL?.trim() || process.env.DEEPSEEK_MODEL?.trim())
    || undefined;
}

function defaultBaseURL(protocol: ProviderProtocol): string {
  return protocol === "anthropic-messages"
    ? "https://api.anthropic.com"
    : "https://api.openai.com/v1";
}

function defaultProviderName(protocol: ProviderProtocol): string {
  return protocol === "anthropic-messages" ? "Anthropic" : "OpenAI-compatible";
}

function readProviderOptionsFromEnvironment(): Record<string, unknown> | undefined {
  const raw = process.env.CHATVERSE_PROVIDER_OPTIONS_JSON?.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object_required");
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(500, "invalid_provider_config", "CHATVERSE_PROVIDER_OPTIONS_JSON 必须是 JSON 对象。 ");
  }
}

function readResearchOptionsFromEnvironment(): Record<string, unknown> | undefined {
  const raw = process.env.CHATVERSE_RESEARCH_OPTIONS_JSON?.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object_required");
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(500, "invalid_provider_config", "CHATVERSE_RESEARCH_OPTIONS_JSON 必须是 JSON 对象。 ");
  }
}

export function hasEnvironmentProviderCredential(): boolean {
  return Boolean(
    process.env.CHATVERSE_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || process.env.DEEPSEEK_API_KEY?.trim()
    || process.env.ANTHROPIC_API_KEY?.trim(),
  );
}

export function debugConfigFromEnvironment(): false | WorldDebugConfig {
  const debugValue = process.env.CHATVERSE_DEBUG?.trim().toLowerCase();
  if (debugValue && ["false", "0", "off", "no"].includes(debugValue)) return false;
  if (process.env.NODE_ENV === "production" && debugValue !== "true") return false;
  return {
    enabled: true,
    tracePrompts: process.env.CHATVERSE_TRACE_PROMPTS?.trim().toLowerCase() === "true",
    traceResponses: process.env.CHATVERSE_TRACE_RESPONSES?.trim().toLowerCase() === "true",
    traceToolCalls: process.env.CHATVERSE_TRACE_TOOL_CALLS?.trim().toLowerCase() === "true",
    includeMemoryContent: process.env.CHATVERSE_DEBUG_MEMORY?.trim().toLowerCase() === "true",
    maxEvents: 2_000,
  };
}

export function createDebugLogWriterFromEnvironment(): {
  write(entry: WorldDebugLogEntry): void;
  close(): void;
} | undefined {
  const path = process.env.CHATVERSE_DEBUG_LOG_PATH?.trim();
  if (!path) return undefined;
  mkdirSync(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { flags: "a", encoding: "utf8" });
  let failed = false;
  stream.on("error", (error) => {
    if (failed) return;
    failed = true;
    console.error(`ChatVerse debug log writer failed for ${path}.`, error);
  });
  return {
    write(entry) {
      if (!failed) stream.write(`${JSON.stringify(entry)}\n`);
    },
    close() {
      stream.end();
    },
  };
}

function configuredProviderTimeoutMs(): number {
  const value = Number(process.env.PROVIDER_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_PROVIDER_TIMEOUT_MS;
}
