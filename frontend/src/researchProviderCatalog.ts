import type { WebResearchProtocol } from "@chatverse/core";

export type ResearchProviderPreset = "deepseek" | "openai" | "tavily" | "zhipu" | "custom";

export interface ResearchProviderPresetDefinition {
  id: ResearchProviderPreset;
  label: string;
  protocol: WebResearchProtocol;
  providerName: string;
  baseURL: string;
  models: readonly { id: string; label: string }[];
  defaultModel?: string;
  options?: Record<string, unknown>;
  note: string;
  websiteURL?: string;
  apiKeyURL?: string;
}

export const RESEARCH_PROVIDER_PRESETS: readonly ResearchProviderPresetDefinition[] = [
  {
    id: "deepseek",
    label: "DeepSeek · Responses 搜索",
    protocol: "responses-web-search",
    providerName: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ],
    defaultModel: "deepseek-v4-flash",
    note: "使用 DeepSeek Responses API 的内置 web_search，不复用文本模型连接。",
    websiteURL: "https://platform.deepseek.com/",
    apiKeyURL: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "tavily",
    label: "Tavily · 专用搜索",
    protocol: "tavily-search",
    providerName: "Tavily",
    baseURL: "https://api.tavily.com",
    models: [],
    options: { searchDepth: "basic", maxResults: 8, includeAnswer: "basic" },
    note: "直接调用 Tavily Search API。无需填写模型名称，适合稳定、低开销的资料检索。",
    websiteURL: "https://www.tavily.com/",
    apiKeyURL: "https://app.tavily.com/home",
  },
  {
    id: "zhipu",
    label: "智谱 · Web Search",
    protocol: "zhipu-web-search",
    providerName: "智谱 AI",
    baseURL: "https://open.bigmodel.cn",
    models: [
      { id: "search_std", label: "标准搜索" },
      { id: "search_pro", label: "高级搜索" },
      { id: "search_pro_sogou", label: "高级搜索 · 搜狗" },
      { id: "search_pro_quark", label: "高级搜索 · 夸克" },
    ],
    defaultModel: "search_std",
    options: { count: 10, contentSize: "medium" },
    note: "直接调用智谱 Web Search API；这里的“模型”实际是搜索引擎档位。",
    websiteURL: "https://open.bigmodel.cn/",
    apiKeyURL: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "openai",
    label: "OpenAI · Responses 搜索",
    protocol: "responses-web-search",
    providerName: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: [
      { id: "gpt-5-mini", label: "GPT-5 mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
    ],
    defaultModel: "gpt-5-mini",
    note: "使用 OpenAI Responses API 的内置 Web Search。",
    websiteURL: "https://platform.openai.com/",
    apiKeyURL: "https://platform.openai.com/api-keys",
  },
  {
    id: "custom",
    label: "自定义联网接口",
    protocol: "responses-web-search",
    providerName: "自定义联网服务",
    baseURL: "",
    models: [],
    note: "选择接口实际使用的联网协议，再填写独立地址、Key 和可选模型。",
  },
] as const;

export function getResearchProviderPreset(id: ResearchProviderPreset): ResearchProviderPresetDefinition {
  return RESEARCH_PROVIDER_PRESETS.find((item) => item.id === id) ?? RESEARCH_PROVIDER_PRESETS[0];
}

export function isResearchProviderPreset(value: unknown): value is ResearchProviderPreset {
  return typeof value === "string" && RESEARCH_PROVIDER_PRESETS.some((item) => item.id === value);
}
