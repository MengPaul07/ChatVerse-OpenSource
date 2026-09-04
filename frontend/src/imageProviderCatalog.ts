export type ImageProviderProtocol =
  | "openai"
  | "gemini"
  | "stability"
  | "bfl"
  | "dashscope"
  | "ark"
  | "siliconflow"
  | "openrouter";

export type ImageProviderPreset =
  | "openai"
  | "packyapi"
  | "gemini"
  | "stability"
  | "bfl"
  | "dashscope"
  | "ark"
  | "siliconflow"
  | "openrouter"
  | "custom-openai";

export interface ImageModelPreset {
  id: string;
  label: string;
}

export interface ImageProviderPresetDefinition {
  id: ImageProviderPreset;
  label: string;
  providerName: string;
  protocol: ImageProviderProtocol;
  protocolLabel: string;
  category: "domestic" | "international" | "custom";
  baseURL: string;
  models: readonly ImageModelPreset[];
  landscapeSizes: readonly string[];
  portraitSizes: readonly string[];
  note: string;
  docsURL: string;
}

const OPENAI_LANDSCAPE = ["1536x1024", "1024x1024"] as const;
const OPENAI_PORTRAIT = ["1024x1536", "1024x1024"] as const;
const GENERAL_LANDSCAPE = ["1696x960", "1664x928", "1536x1024", "1024x1024"] as const;
const GENERAL_PORTRAIT = ["960x1696", "928x1664", "1024x1536", "1024x1024"] as const;

/**
 * 厂商目录只负责填写协议所需的稳定默认值。模型 ID 仍可编辑，避免目录更新
 * 成为接入新模型的前置条件。
 */
export const IMAGE_PROVIDER_PRESETS: readonly ImageProviderPresetDefinition[] = [
  {
    id: "openai",
    label: "OpenAI Images",
    providerName: "OpenAI",
    protocol: "openai",
    protocolLabel: "OpenAI Images · 同步",
    category: "international",
    baseURL: "https://api.openai.com/v1",
    models: [
      { id: "gpt-image-2", label: "GPT Image 2 · 最新" },
      { id: "gpt-image-1.5", label: "GPT Image 1.5 · 高质量" },
      { id: "gpt-image-1", label: "GPT Image 1 · 通用" },
      { id: "gpt-image-1-mini", label: "GPT Image 1 mini · 低成本" },
    ],
    landscapeSizes: OPENAI_LANDSCAPE,
    portraitSizes: OPENAI_PORTRAIT,
    note: "使用 OpenAI Images API；账号需要拥有对应图片模型权限。",
    docsURL: "https://platform.openai.com/docs/guides/image-generation",
  },
  {
    id: "packyapi",
    label: "PackyAPI · GPT Image 2",
    providerName: "PackyAPI",
    protocol: "openai",
    protocolLabel: "OpenAI Images · 同步",
    category: "domestic",
    baseURL: "https://cf.api.fan/v1",
    models: [
      { id: "gpt-image-2", label: "GPT Image 2 · 推荐" },
    ],
    landscapeSizes: ["1536x1024", "1536x864", "2048x1152", "1024x1024"],
    portraitSizes: ["1024x1536", "1152x2048", "1024x1024"],
    note: "使用 PackyAPI 的 OpenAI Images 接口；需要 Sora 分组令牌，Base URL 必须包含 /v1。",
    docsURL: "https://docs.packyapi.ai/docs/paint/GPTImage.html",
  },
  {
    id: "gemini",
    label: "Google Gemini Image",
    providerName: "Google Gemini",
    protocol: "gemini",
    protocolLabel: "Gemini Interactions · 同步",
    category: "international",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      { id: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image · 推荐" },
      { id: "gemini-3.1-flash-lite-image", label: "Gemini 3.1 Flash Lite Image · 快速" },
      { id: "gemini-3-pro-image", label: "Gemini 3 Pro Image · 专业" },
      { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image · 兼容" },
    ],
    landscapeSizes: ["2048x1152", "1376x768", "1024x1024"],
    portraitSizes: ["1152x2048", "768x1376", "1024x1024"],
    note: "通过 Gemini 原生 Interactions API 生成；宽高会转换为最接近的画幅与 1K/2K/4K 档位。",
    docsURL: "https://ai.google.dev/gemini-api/docs/image-generation",
  },
  {
    id: "stability",
    label: "Stability AI",
    providerName: "Stability AI",
    protocol: "stability",
    protocolLabel: "Stable Image · Multipart",
    category: "international",
    baseURL: "https://api.stability.ai",
    models: [
      { id: "core", label: "Stable Image Core · 平衡" },
      { id: "ultra", label: "Stable Image Ultra · 高质量" },
      { id: "sd3", label: "Stable Diffusion 3 · 可控" },
    ],
    landscapeSizes: ["1536x1024", "1344x768", "1024x1024"],
    portraitSizes: ["1024x1536", "768x1344", "1024x1024"],
    note: "模型字段对应 Stable Image 的生成接口名称；尺寸会转换为官方画幅参数。",
    docsURL: "https://platform.stability.ai/docs/api-reference",
  },
  {
    id: "bfl",
    label: "Black Forest Labs · FLUX",
    providerName: "Black Forest Labs",
    protocol: "bfl",
    protocolLabel: "FLUX API · 异步轮询",
    category: "international",
    baseURL: "https://api.bfl.ai",
    models: [
      { id: "flux-2-pro-preview", label: "FLUX.2 Pro Preview · 推荐" },
      { id: "flux-2-max", label: "FLUX.2 Max · 最高质量" },
      { id: "flux-2-pro", label: "FLUX.2 Pro · 高质量" },
      { id: "flux-2-flex", label: "FLUX.2 Flex · 灵活" },
      { id: "flux-2-klein-9b", label: "FLUX.2 Klein 9B · 平衡" },
      { id: "flux-2-klein-4b", label: "FLUX.2 Klein 4B · 快速" },
    ],
    landscapeSizes: ["1440x810", "1536x1024", "1024x1024"],
    portraitSizes: ["810x1440", "1024x1536", "1024x1024"],
    note: "服务端创建任务后按 polling_url 等待结果，完成后立即下载临时图片链接。",
    docsURL: "https://docs.bfl.ai/quick_start/generating_images",
  },
  {
    id: "dashscope",
    label: "阿里云百炼 · 万相/千问图像",
    providerName: "阿里云百炼",
    protocol: "dashscope",
    protocolLabel: "百炼多模态生成 · 同步",
    category: "domestic",
    baseURL: "https://dashscope.aliyuncs.com",
    models: [
      { id: "wan2.7-image-pro", label: "Wan 2.7 Image Pro · 高质量" },
      { id: "wan2.7-image", label: "Wan 2.7 Image · 快速" },
      { id: "wan2.6-image", label: "Wan 2.6 Image · 兼容" },
      { id: "qwen-image-3.0-pro", label: "Qwen Image 3.0 Pro · 文字与设计" },
      { id: "qwen-image-3.0", label: "Qwen Image 3.0 · 通用" },
      { id: "qwen-image-2.0-pro", label: "Qwen Image 2.0 Pro · 兼容" },
      { id: "z-image-turbo", label: "Z-Image Turbo · 低成本" },
    ],
    landscapeSizes: GENERAL_LANDSCAPE,
    portraitSizes: GENERAL_PORTRAIT,
    note: "推荐把 Base URL 换成百炼控制台提供的业务空间专属域名；北京与新加坡 Key 不通用。",
    docsURL: "https://help.aliyun.com/zh/model-studio/image-model",
  },
  {
    id: "ark",
    label: "火山方舟 · Seedream",
    providerName: "火山方舟",
    protocol: "ark",
    protocolLabel: "Ark Images · 同步",
    category: "domestic",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    models: [
      { id: "doubao-seedream-5-0-lite-260128", label: "Seedream 5.0 Lite · 推荐" },
      { id: "doubao-seedream-4-5-251128", label: "Seedream 4.5 · 高质量" },
      { id: "doubao-seedream-4-0-250828", label: "Seedream 4.0 · 兼容" },
    ],
    landscapeSizes: ["2048x1152", "2560x1440", "1536x1024"],
    portraitSizes: ["1152x2048", "1440x2560", "1024x1536"],
    note: "使用火山方舟原生图片生成接口，支持 URL 与 Base64 返回；模型 ID 以控制台端点为准。",
    docsURL: "https://www.volcengine.com/docs/82379/1541523",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    providerName: "硅基流动",
    protocol: "siliconflow",
    protocolLabel: "SiliconFlow Images · 同步",
    category: "domestic",
    baseURL: "https://api.siliconflow.cn/v1",
    models: [
      { id: "Qwen/Qwen-Image", label: "Qwen Image · 推荐" },
      { id: "Kwai-Kolors/Kolors", label: "Kolors · 通用" },
    ],
    landscapeSizes: ["1664x928", "1584x1056", "1024x1024"],
    portraitSizes: ["928x1664", "1056x1584", "960x1280"],
    note: "使用 image_size 原生参数；不同模型支持的推荐尺寸不同，可按模型文档直接修改。",
    docsURL: "https://api-docs.siliconflow.cn/docs/api/images-generations-post",
  },
  {
    id: "openrouter",
    label: "OpenRouter Images · 聚合",
    providerName: "OpenRouter",
    protocol: "openrouter",
    protocolLabel: "OpenRouter Images · 聚合",
    category: "international",
    baseURL: "https://openrouter.ai/api/v1",
    models: [
      { id: "openai/gpt-image-2", label: "OpenAI · GPT Image 2" },
      { id: "black-forest-labs/flux.2-max", label: "Black Forest Labs · FLUX.2 Max" },
      { id: "black-forest-labs/flux.2-pro", label: "Black Forest Labs · FLUX.2 Pro" },
      { id: "google/gemini-3.1-flash-image", label: "Google · Gemini 3.1 Flash Image" },
      { id: "bytedance-seed/seedream-5-0-pro", label: "ByteDance · Seedream 5.0 Pro" },
      { id: "qwen/qwen-image-3-pro", label: "Qwen · Qwen Image 3 Pro" },
      { id: "recraft/recraft-v4.1-pro", label: "Recraft · V4.1 Pro" },
    ],
    landscapeSizes: ["2048x1152", "1536x1024", "1024x1024"],
    portraitSizes: ["1152x2048", "1024x1536", "1024x1024"],
    note: "统一访问多家图片模型；具体尺寸与价格取决于所选模型的上游端点。",
    docsURL: "https://openrouter.ai/docs/guides/overview/multimodal/image-generation",
  },
  {
    id: "custom-openai",
    label: "自定义 OpenAI Images",
    providerName: "自定义图片服务",
    protocol: "openai",
    protocolLabel: "OpenAI Images 兼容协议",
    category: "custom",
    baseURL: "",
    models: [],
    landscapeSizes: OPENAI_LANDSCAPE,
    portraitSizes: OPENAI_PORTRAIT,
    note: "适用于实现 /images/generations 的企业网关或第三方兼容服务；公开服务端不允许代理内网地址。",
    docsURL: "https://platform.openai.com/docs/guides/image-generation",
  },
] as const;

export function getImageProviderPresetDefinition(preset: ImageProviderPreset): ImageProviderPresetDefinition {
  return IMAGE_PROVIDER_PRESETS.find((definition) => definition.id === preset) ?? IMAGE_PROVIDER_PRESETS[0];
}

export function isImageProviderPreset(value: unknown): value is ImageProviderPreset {
  return typeof value === "string" && IMAGE_PROVIDER_PRESETS.some((definition) => definition.id === value);
}

export function isImageProviderProtocol(value: unknown): value is ImageProviderProtocol {
  return typeof value === "string" && IMAGE_PROVIDER_PRESETS.some((definition) => definition.protocol === value);
}
