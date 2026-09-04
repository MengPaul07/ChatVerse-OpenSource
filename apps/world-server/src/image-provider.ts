import type { IncomingMessage } from "node:http";
import {
  ImageProviderError,
  imageProviderAdapter,
  type GeneratedImage,
  type ImageGenerationInput,
  type ImageProviderConfig,
  type ImageProviderProtocol,
  type ImageProviderTestResult,
} from "./image-providers/index.js";
import { assertSafeRemoteUrl } from "./image-providers/shared.js";

export const IMAGE_API_KEY_HEADER = "x-chatverse-image-api-key";
export const IMAGE_BASE_URL_HEADER = "x-chatverse-image-api-base-url";
export const IMAGE_MODEL_HEADER = "x-chatverse-image-model";
export const IMAGE_PROTOCOL_HEADER = "x-chatverse-image-protocol";

const IMAGE_PROVIDER_PROTOCOLS = new Set<ImageProviderProtocol>([
  "openai",
  "gemini",
  "stability",
  "bfl",
  "dashscope",
  "ark",
  "siliconflow",
  "openrouter",
]);

export function imageProviderConfigFromRequest(request: IncomingMessage): ImageProviderConfig | undefined {
  const apiKey = header(request, IMAGE_API_KEY_HEADER);
  const baseURL = header(request, IMAGE_BASE_URL_HEADER);
  const model = header(request, IMAGE_MODEL_HEADER);
  const protocol = header(request, IMAGE_PROTOCOL_HEADER) ?? "openai";
  if (!apiKey || !baseURL || !model) return undefined;
  if (!IMAGE_PROVIDER_PROTOCOLS.has(protocol as ImageProviderProtocol)) return undefined;
  const normalizedBaseURL = baseURL.replace(/\/+$/, "");
  assertSafeRemoteUrl(normalizedBaseURL);
  return { apiKey, baseURL: normalizedBaseURL, model, protocol: protocol as ImageProviderProtocol };
}

export async function generateImage(
  config: ImageProviderConfig,
  input: ImageGenerationInput,
): Promise<GeneratedImage> {
  const adapter = imageProviderAdapter(config.protocol);
  if (!input.referenceImage) return adapter.generate(config, input);
  if (!adapter.edit) {
    throw new ImageProviderError("当前图片协议不支持参考图生成，请切换到 OpenAI Images 兼容协议或使用全新生成。");
  }
  return adapter.edit(config, input);
}

export async function testImageProvider(config: ImageProviderConfig): Promise<ImageProviderTestResult> {
  return imageProviderAdapter(config.protocol).test(config);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

export type { GeneratedImage, ImageProviderConfig, ImageProviderProtocol, ImageProviderTestResult };
