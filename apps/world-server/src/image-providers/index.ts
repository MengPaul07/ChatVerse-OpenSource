import { bflImageAdapter } from "./bfl.js";
import { dashScopeImageAdapter } from "./dashscope.js";
import { geminiImageAdapter } from "./gemini.js";
import { arkImageAdapter, openAIImageAdapter, openRouterImageAdapter } from "./openai.js";
import { siliconFlowImageAdapter } from "./siliconflow.js";
import { stabilityImageAdapter } from "./stability.js";
import type { ImageProviderAdapter, ImageProviderProtocol } from "./types.js";

const ADAPTERS: Record<ImageProviderProtocol, ImageProviderAdapter> = {
  openai: openAIImageAdapter,
  gemini: geminiImageAdapter,
  stability: stabilityImageAdapter,
  bfl: bflImageAdapter,
  dashscope: dashScopeImageAdapter,
  ark: arkImageAdapter,
  siliconflow: siliconFlowImageAdapter,
  openrouter: openRouterImageAdapter,
};

export function imageProviderAdapter(protocol: ImageProviderProtocol): ImageProviderAdapter {
  return ADAPTERS[protocol];
}

export type {
  GeneratedImage,
  ImageGenerationInput,
  ImageProviderConfig,
  ImageProviderProtocol,
  ImageProviderTestResult,
} from "./types.js";
export { ImageProviderError } from "./types.js";
