import { ImageProviderError, type ImageProviderAdapter } from "./types.js";
import {
  endpoint,
  imageFromBase64,
  imageFromUrl,
  requestJson,
  requestStatus,
} from "./shared.js";

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
}

export const openAIImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    const payload = await requestJson<OpenAIImageResponse>(
      endpoint(config.baseURL, "images/generations"),
      {
        method: "POST",
        headers: bearerHeaders(config.apiKey),
        body: JSON.stringify({
          model: config.model,
          prompt: input.prompt,
          size: input.size,
          n: 1,
        }),
      },
      "图片生成",
    );
    return openAIImageResult(payload, config.model);
  },
  async edit(config, input) {
    if (!input.referenceImage) throw new ImageProviderError("图生图请求缺少参考图片。");
    const form = new FormData();
    form.append("model", config.model);
    form.append("prompt", input.prompt);
    form.append("size", input.size);
    form.append("n", "1");
    form.append(
      "image",
      new Blob([Uint8Array.from(input.referenceImage.bytes)], { type: input.referenceImage.mimeType }),
      `reference.${extensionFor(input.referenceImage.mimeType)}`,
    );
    const payload = await requestJson<OpenAIImageResponse>(
      endpoint(config.baseURL, "images/edits"),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
      },
      "参考图生成",
    );
    return openAIImageResult(payload, config.model);
  },
  async test(config) {
    await requestStatus(endpoint(config.baseURL, "models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, "图片模型连接测试");
    return { verification: "credentials" };
  },
};

export const openRouterImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    const payload = await requestJson<OpenAIImageResponse>(
      endpoint(config.baseURL, "images"),
      {
        method: "POST",
        headers: bearerHeaders(config.apiKey),
        body: JSON.stringify({
          model: config.model,
          prompt: input.prompt,
          size: input.size,
          n: 1,
        }),
      },
      "OpenRouter 图片生成",
    );
    return openAIImageResult(payload, config.model);
  },
  async test(config) {
    await requestStatus(endpoint(config.baseURL, "images/models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, "OpenRouter 图片模型连接测试");
    return { verification: "credentials" };
  },
};

export const arkImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    const payload = await requestJson<OpenAIImageResponse>(
      endpoint(config.baseURL, "images/generations"),
      {
        method: "POST",
        headers: bearerHeaders(config.apiKey),
        body: JSON.stringify({
          model: config.model,
          prompt: input.prompt,
          size: input.size,
          response_format: "b64_json",
          stream: false,
          watermark: false,
          sequential_image_generation: "disabled",
        }),
      },
      "火山方舟图片生成",
    );
    return openAIImageResult(payload, config.model);
  },
  async test(config) {
    await requestStatus(endpoint(config.baseURL, "models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, "火山方舟连接测试");
    return { verification: "credentials" };
  },
};

async function openAIImageResult(payload: OpenAIImageResponse, model: string) {
  const item = payload.data?.[0];
  if (!item) throw new ImageProviderError("图片服务没有返回图片。");
  if (item.b64_json) return imageFromBase64(item.b64_json, model, undefined, item.revised_prompt);
  if (item.url) return imageFromUrl(item.url, model, item.revised_prompt);
  throw new ImageProviderError("图片服务响应中缺少图片数据。");
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function extensionFor(mimeType: "image/png" | "image/jpeg" | "image/webp"): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}
