import {
  createFallbackModelProfile,
  getBuiltInModelProfile,
  resolveModelProfile,
} from "@chatverse/core";
import type {
  ProviderCapabilities,
  ProviderModelProfile,
  ProviderProtocol,
} from "@chatverse/core";

export type ProviderPreset =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "gemini"
  | "mistral"
  | "xai"
  | "openrouter"
  | "stepfun"
  | "siliconflow"
  | "modelscope"
  | "longcat"
  | "mimo"
  | "doubao"
  | "hunyuan"
  | "nvidia"
  | "novita"
  | "custom";

export type { ProviderCapabilities, ProviderProtocol } from "@chatverse/core";

export interface ProviderModelPreset {
  id: string;
  label: string;
  note?: string;
  contextWindow?: number;
  reasoningLevels?: readonly string[];
  inputModalities?: readonly ("text" | "image")[];
  /** PI-style concrete model compatibility metadata. */
  profile?: ProviderModelProfile;
}

export interface ProviderPresetDefinition {
  id: ProviderPreset;
  label: string;
  providerName: string;
  baseURL: string;
  category: "model-vendor" | "gateway" | "custom";
  models: readonly ProviderModelPreset[];
  protocol?: ProviderProtocol;
  capabilities?: Partial<ProviderCapabilities>;
  providerOptions?: Record<string, unknown>;
  note?: string;
  websiteURL?: string;
  apiKeyURL?: string;
  apiCompatibility?: "chat" | "chat-and-responses";
}

/**
 * 只收录适合 ChatVerse 文本编排的协议入口。
 * 模型 ID 会持续变化，因此 UI 使用可编辑的 datalist，而不是硬限制下拉选项。
 */
export const PROVIDER_PRESETS: readonly ProviderPresetDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    providerName: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    category: "model-vendor",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol · 旗舰", contextWindow: 1_050_000, reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"], inputModalities: ["text", "image"] },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra · 平衡", contextWindow: 1_050_000, reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"], inputModalities: ["text", "image"] },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna · 高性价比", contextWindow: 1_050_000, reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"], inputModalities: ["text", "image"] },
      { id: "gpt-5.2", label: "GPT-5.2 · 高能力", reasoningLevels: ["none", "low", "medium", "high"] },
      { id: "gpt-5.1", label: "GPT-5.1 · 通用", reasoningLevels: ["none", "low", "medium", "high"] },
      { id: "gpt-5-mini", label: "GPT-5 mini · 平衡" },
      { id: "gpt-5-nano", label: "GPT-5 nano · 低成本" },
      { id: "gpt-4.1", label: "GPT-4.1 · 稳定" },
    ],
    websiteURL: "https://platform.openai.com/",
    apiKeyURL: "https://platform.openai.com/api-keys",
    apiCompatibility: "chat-and-responses",
    capabilities: { reasoning: "option", toolChoice: "required" },
    providerOptions: { openai: { reasoningEffort: true, toolChoice: "required" } },
    note: "模型是否对当前账号开放，以 OpenAI 控制台为准。",
  },
  {
    id: "anthropic",
    label: "Anthropic · Claude",
    providerName: "Anthropic",
    baseURL: "https://api.anthropic.com",
    category: "model-vendor",
    protocol: "anthropic-messages",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 · 平衡", contextWindow: 200_000, reasoningLevels: ["none", "high"] },
      { id: "claude-opus-4-20250514", label: "Claude Opus 4 · 高能力", contextWindow: 200_000, reasoningLevels: ["none", "high"] },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku · 快速", contextWindow: 200_000 },
    ],
    capabilities: {
      stream: true,
      tools: true,
      json: "prompt",
      reasoning: "option",
      webSearch: false,
    },
    websiteURL: "https://console.anthropic.com/",
    apiKeyURL: "https://console.anthropic.com/settings/keys",
    apiCompatibility: "chat",
    note: "使用 Anthropic Messages API。联网创作暂不支持 Anthropic 协议。",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    providerName: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    category: "model-vendor",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash · 快速", contextWindow: 1_048_576, reasoningLevels: ["low", "high", "max"], inputModalities: ["text"] },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro · 高能力", contextWindow: 1_048_576, reasoningLevels: ["low", "high", "max"], inputModalities: ["text"] },
    ],
    websiteURL: "https://platform.deepseek.com/",
    apiKeyURL: "https://platform.deepseek.com/api_keys",
    apiCompatibility: "chat-and-responses",
    capabilities: { reasoning: "option", toolChoice: "required" },
    providerOptions: {
      openai: {
        thinking: true,
        reasoningEffort: true,
        omitToolChoiceWhenThinking: true,
        toolChoice: "required",
      },
    },
    note: "具体可用模型和额度以 DeepSeek 账户与控制台为准。",
  },
  {
    id: "qwen",
    label: "阿里云百炼 · Qwen",
    providerName: "阿里云百炼",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    category: "model-vendor",
    models: [
      { id: "qwen3.7-max", label: "Qwen3.7 Max · 高能力" },
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus · Agent", contextWindow: 1_048_576 },
      { id: "qwen3.7-plus", label: "Qwen3.7 Plus · 平衡" },
      { id: "qwen3.6-flash", label: "Qwen3.6 Flash · 快速" },
      { id: "qwen3-max", label: "Qwen3 Max · 兼容" },
      { id: "qwen-plus", label: "Qwen Plus · 通用" },
    ],
    websiteURL: "https://bailian.console.aliyun.com/",
    apiKeyURL: "https://bailian.console.aliyun.com/#/api-key",
    apiCompatibility: "chat-and-responses",
    note: "部分百炼区域或工作空间需要改用控制台提供的兼容 Base URL。",
  },
  {
    id: "moonshot",
    label: "Moonshot · Kimi",
    providerName: "Moonshot",
    baseURL: "https://api.moonshot.cn/v1",
    category: "model-vendor",
    models: [
      { id: "kimi-k3", label: "Kimi K3 · 长上下文", contextWindow: 1_048_576, reasoningLevels: ["low", "high", "max"] },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code · Agent", contextWindow: 262_144, reasoningLevels: ["high"] },
      { id: "kimi-k2.6", label: "Kimi K2.6 · 通用" },
      { id: "kimi-k2.5", label: "Kimi K2.5 · 兼容" },
      { id: "moonshot-v1", label: "Moonshot V1 · 兼容" },
    ],
    websiteURL: "https://platform.kimi.com/",
    apiKeyURL: "https://platform.kimi.com/console/api-keys",
    apiCompatibility: "chat",
    note: "Kimi API 使用无状态 Chat Completions，适合直接接入本地上下文。",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    providerName: "智谱 AI",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    category: "model-vendor",
    models: [
      { id: "glm-5.3", label: "GLM-5.3 · 高能力", contextWindow: 200_000 },
      { id: "glm-5.3-flash", label: "GLM-5.3 Flash · 轻量", contextWindow: 200_000 },
      { id: "glm-5.2", label: "GLM-5.2 · 高能力", contextWindow: 200_000, reasoningLevels: ["none", "high"] },
      { id: "glm-5.1", label: "GLM-5.1 · 通用", contextWindow: 200_000, reasoningLevels: ["none", "high"] },
      { id: "glm-5", label: "GLM-5 · 通用" },
      { id: "glm-4.7", label: "GLM-4.7 · 平衡" },
      { id: "glm-4.5-air", label: "GLM-4.5-Air · 轻量" },
    ],
    websiteURL: "https://open.bigmodel.cn/",
    apiCompatibility: "chat",
    capabilities: { toolChoice: "auto" },
    providerOptions: { openai: { toolChoice: "auto" } },
    note: "模型名大小写按智谱接口文档填写；Coding Plan 使用单独的 Base URL。",
  },
  {
    id: "minimax",
    label: "MiniMax",
    providerName: "MiniMax",
    baseURL: "https://api.minimaxi.com/v1",
    category: "model-vendor",
    models: [
      { id: "MiniMax-M3", label: "MiniMax M3 · 长上下文", contextWindow: 1_000_000, reasoningLevels: ["none", "high"], inputModalities: ["text", "image"] },
      { id: "MiniMax-M2.5", label: "MiniMax M2.5 · 平衡" },
      { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 Highspeed · 快速" },
      { id: "M2-her", label: "M2-her · 对话" },
    ],
    websiteURL: "https://platform.minimaxi.com/",
    apiKeyURL: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    apiCompatibility: "chat-and-responses",
    note: "MiniMax 同时提供 OpenAI-compatible 与其他协议，当前预设使用 OpenAI-compatible。",
  },
  {
    id: "gemini",
    label: "Google · Gemini",
    providerName: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    category: "model-vendor",
    models: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash · 通用" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash · 平衡" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite · 快速" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro · 稳定" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash · 兼容" },
    ],
    note: "Google 的 OpenAI 兼容层有部分能力差异，复杂工具调用请以实际响应为准。",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    providerName: "Mistral AI",
    baseURL: "https://api.mistral.ai/v1",
    category: "model-vendor",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large · 高能力" },
      { id: "mistral-medium-latest", label: "Mistral Medium · 平衡" },
      { id: "mistral-small-latest", label: "Mistral Small · 轻量" },
      { id: "magistral-medium-latest", label: "Magistral Medium · 推理" },
      { id: "devstral-small-latest", label: "Devstral Small · 编程" },
    ],
    note: "Mistral 文档明确支持通过 OpenAI-compatible 客户端切换 Base URL。",
  },
  {
    id: "xai",
    label: "xAI · Grok",
    providerName: "xAI",
    baseURL: "https://api.x.ai/v1",
    category: "model-vendor",
    models: [
      { id: "grok-4.5", label: "Grok 4.5 · 默认", contextWindow: 500_000, reasoningLevels: ["low", "medium", "high"], inputModalities: ["text", "image"] },
      { id: "grok-4.20-0309-reasoning", label: "Grok 4.20 · 推理" },
      { id: "grok-4.20-0309-non-reasoning", label: "Grok 4.20 · 非推理" },
    ],
    websiteURL: "https://x.ai/api",
    apiKeyURL: "https://console.x.ai/",
    apiCompatibility: "chat-and-responses",
    capabilities: { reasoning: "option" },
    note: "xAI 同时支持 Chat Completions 和 Responses API；本应用使用前者。",
  },
  {
    id: "openrouter",
    label: "OpenRouter · 聚合",
    providerName: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    category: "gateway",
    models: [
      { id: "openai/gpt-5-mini", label: "OpenAI · GPT-5 mini" },
      { id: "google/gemini-3.5-flash", label: "Google · Gemini 3.5 Flash" },
      { id: "deepseek/deepseek-v4-flash", label: "DeepSeek · V4 Flash" },
      { id: "qwen/qwen3.7-plus", label: "Qwen · 3.7 Plus" },
    ],
    note: "OpenRouter 是聚合入口，模型 ID 以其 Models 页面和账户可用性为准。",
    websiteURL: "https://openrouter.ai/models",
    apiKeyURL: "https://openrouter.ai/keys",
    apiCompatibility: "chat",
  },
  {
    id: "stepfun",
    label: "阶跃星辰 · StepFun",
    providerName: "StepFun",
    baseURL: "https://api.stepfun.com/step_plan/v1",
    category: "model-vendor",
    models: [
      { id: "step-3.7-flash", label: "Step 3.7 Flash · 默认", contextWindow: 262_144, reasoningLevels: ["low", "medium", "high"] },
      { id: "step-3.5-flash-2603", label: "Step 3.5 Flash 2603", contextWindow: 262_144, reasoningLevels: ["low", "high"] },
      { id: "step-3.5-flash", label: "Step 3.5 Flash", contextWindow: 262_144 },
    ],
    note: "该预设对应 Step Plan，需使用对应套餐的 Interface Key。",
    websiteURL: "https://platform.stepfun.com/step-plan",
    apiKeyURL: "https://platform.stepfun.com/interface-key",
    apiCompatibility: "chat",
  },
  {
    id: "longcat",
    label: "美团 · LongCat",
    providerName: "LongCat",
    baseURL: "https://api.longcat.chat/openai/v1",
    category: "model-vendor",
    models: [
      { id: "LongCat-2.0", label: "LongCat 2.0 · 长上下文", contextWindow: 1_048_576, reasoningLevels: ["high"] },
    ],
    note: "LongCat 2.0 提供 OpenAI-compatible 接口；可用能力以平台控制台为准。",
    websiteURL: "https://longcat.chat/platform",
    apiKeyURL: "https://longcat.chat/platform/api_keys",
    apiCompatibility: "chat-and-responses",
  },
  {
    id: "mimo",
    label: "小米 · MiMo",
    providerName: "Xiaomi MiMo",
    baseURL: "https://api.xiaomimimo.com/v1",
    category: "model-vendor",
    models: [
      { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro · Agent", contextWindow: 1_048_576, reasoningLevels: ["none", "high"], inputModalities: ["text"] },
      { id: "mimo-v2.5", label: "MiMo V2.5 · 多模态", contextWindow: 1_048_576, reasoningLevels: ["none", "high"], inputModalities: ["text", "image"] },
    ],
    note: "普通 API 与 Token Plan 的 Key 和 Base URL 不同；此处使用普通开放平台。",
    websiteURL: "https://platform.xiaomimimo.com/",
    apiKeyURL: "https://platform.xiaomimimo.com/#/console/api-keys",
    apiCompatibility: "chat-and-responses",
  },
  {
    id: "doubao",
    label: "火山方舟 · Doubao Seed",
    providerName: "Volcengine Ark",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    category: "model-vendor",
    models: [
      { id: "doubao-seed-2-1-pro-260628", label: "Doubao Seed 2.1 Pro", contextWindow: 262_144, reasoningLevels: ["minimal", "low", "medium", "high"] },
    ],
    note: "火山方舟按量端点；模型 ID 和地域可能随控制台接入点变化，可直接编辑。",
    websiteURL: "https://console.volcengine.com/ark/",
    apiCompatibility: "chat-and-responses",
  },
  {
    id: "hunyuan",
    label: "腾讯混元 · TokenHub",
    providerName: "Tencent Hunyuan",
    baseURL: "https://tokenhub.tencentmaas.com/v1",
    category: "model-vendor",
    models: [
      { id: "hy3", label: "Hy3 · 默认", contextWindow: 256_000, reasoningLevels: ["low", "high"], inputModalities: ["text"] },
      { id: "hy3-preview", label: "Hy3 Preview", contextWindow: 256_000, reasoningLevels: ["low", "high"], inputModalities: ["text"] },
    ],
    note: "需要 TokenHub API Key；其他混元套餐的 Key 不一定能用于此端点。",
    websiteURL: "https://cloud.tencent.com/product/tokenhub",
    apiKeyURL: "https://console.cloud.tencent.com/tokenhub/apikey",
    apiCompatibility: "chat-and-responses",
  },
  {
    id: "siliconflow",
    label: "硅基流动 · 聚合",
    providerName: "SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    category: "gateway",
    models: [
      { id: "Pro/MiniMaxAI/MiniMax-M2.5", label: "Pro · MiniMax M2.5", contextWindow: 196_608 },
    ],
    note: "中国站与国际站模型目录不同；此预设使用中国站当前可用模型 ID。",
    websiteURL: "https://siliconflow.cn/",
    apiCompatibility: "chat",
  },
  {
    id: "modelscope",
    label: "魔搭 ModelScope · 聚合",
    providerName: "ModelScope",
    baseURL: "https://api-inference.modelscope.cn/v1",
    category: "gateway",
    models: [
      { id: "ZhipuAI/GLM-5.2", label: "ZhipuAI · GLM-5.2", contextWindow: 200_000 },
    ],
    note: "使用魔搭社区 API-Inference Token；模型 ID 必须带组织前缀。",
    websiteURL: "https://modelscope.cn/",
    apiKeyURL: "https://modelscope.cn/my/myaccesstoken",
    apiCompatibility: "chat",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM · 聚合",
    providerName: "NVIDIA NIM",
    baseURL: "https://integrate.api.nvidia.com/v1",
    category: "gateway",
    models: [
      { id: "moonshotai/kimi-k2.5", label: "Moonshot AI · Kimi K2.5", contextWindow: 262_144 },
    ],
    note: "NIM 的参数支持按模型变化，ChatVerse 不会额外注入厂商私有 thinking 字段。",
    websiteURL: "https://build.nvidia.com/",
    apiKeyURL: "https://build.nvidia.com/settings/api-keys",
    apiCompatibility: "chat",
  },
  {
    id: "novita",
    label: "Novita AI · 聚合",
    providerName: "Novita AI",
    baseURL: "https://api.novita.ai/openai/v1",
    category: "gateway",
    models: [
      { id: "zai-org/glm-5.1", label: "Z.AI · GLM-5.1", contextWindow: 202_800, reasoningLevels: ["none", "high"] },
    ],
    note: "Novita 使用 enable_thinking 方言；当前 ChatVerse 仅发送标准 Chat Completions 参数。",
    websiteURL: "https://novita.ai/",
    apiKeyURL: "https://novita.ai/settings/key-management",
    apiCompatibility: "chat",
  },
  {
    id: "custom",
    label: "自定义 OpenAI-compatible",
    providerName: "自定义服务商",
    baseURL: "",
    category: "custom",
    models: [],
    protocol: "openai-chat",
    capabilities: {
      stream: true,
      tools: true,
      json: "native",
      reasoning: "none",
      webSearch: false,
      vision: false,
    },
    note: "适用于本地 vLLM、Ollama 兼容网关、企业代理或其他兼容服务。",
  },
] as const;

export function getProviderPresetDefinition(preset: ProviderPreset): ProviderPresetDefinition {
  return PROVIDER_PRESETS.find((definition) => definition.id === preset) ?? PROVIDER_PRESETS[0];
}

/**
 * Resolve the concrete model profile sent to the server. This mirrors PI's
 * provider-level defaults plus model-level overrides while keeping the
 * browser catalog free of credentials.
 */
export function getProviderModelProfile(
  definition: ProviderPresetDefinition,
  modelId: string,
): ProviderModelProfile {
  const model = definition.models.find((candidate) => candidate.id === modelId);
  const protocol = providerProtocol(definition);
  const base = model?.profile
    ? resolveModelProfile(protocol, modelId, model.profile)
    : createFallbackModelProfile(protocol, modelId);
  const builtIn = getBuiltInModelProfile(protocol, modelId);
  const levels = model?.reasoningLevels ?? [];
  const reasoning = base.reasoning || levels.some((level) => level !== "none");
  const profile: ProviderModelProfile = {
    ...base,
    id: modelId,
    name: model?.label ?? builtIn?.name ?? modelId,
    reasoning,
    input: [...(model?.inputModalities ?? base.input)],
    ...(model?.contextWindow ?? base.contextWindow
      ? { contextWindow: model?.contextWindow ?? base.contextWindow }
      : {}),
    maxTokens: Math.max(32_768, base.maxTokens ?? 32_768),
    thinkingLevelMap: base.thinkingLevelMap
      ?? (reasoning
        ? Object.fromEntries(levels.filter((level) => level !== "none").map((level) => [level, level])) as ProviderModelProfile["thinkingLevelMap"]
        : { off: "off" }),
    compatibility: base.compatibility,
  };
  return profile;
}

export function providerProtocol(definition: ProviderPresetDefinition): ProviderProtocol {
  return definition.protocol ?? "openai-chat";
}

export function providerCapabilities(definition: ProviderPresetDefinition): ProviderCapabilities {
  const protocol = providerProtocol(definition);
  const defaults: ProviderCapabilities = protocol === "anthropic-messages"
    ? {
        stream: true,
        tools: true,
        json: "prompt",
        reasoning: "none",
        webSearch: false,
        vision: false,
        toolChoice: "required",
      }
    : {
        stream: true,
        tools: true,
        json: "native",
        reasoning: "none",
        webSearch: false,
        vision: false,
        toolChoice: "auto",
      };
  return { ...defaults, ...definition.capabilities };
}

export function isProviderPreset(value: unknown): value is ProviderPreset {
  return typeof value === "string" && PROVIDER_PRESETS.some((definition) => definition.id === value);
}
