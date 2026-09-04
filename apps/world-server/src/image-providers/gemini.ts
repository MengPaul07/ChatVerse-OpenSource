import { ImageProviderError, type ImageProviderAdapter } from "./types.js";
import {
  closestAspectRatio,
  endpoint,
  imageFromBase64,
  imageSizeTier,
  requestJson,
  requestStatus,
} from "./shared.js";

interface GeminiImageContent {
  type?: string;
  data?: string;
  mime_type?: string;
}

interface GeminiInteractionResponse {
  steps?: Array<{ type?: string; content?: GeminiImageContent[] }>;
  outputs?: GeminiImageContent[];
  output_image?: GeminiImageContent;
}

export const geminiImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    const payload = await requestJson<GeminiInteractionResponse>(
      endpoint(config.baseURL, "interactions"),
      {
        method: "POST",
        headers: {
          "x-goog-api-key": config.apiKey,
          "Api-Revision": "2026-05-20",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          input: input.prompt,
          response_format: {
            type: "image",
            mime_type: "image/jpeg",
            aspect_ratio: closestAspectRatio(input.size),
            image_size: imageSizeTier(input.size),
          },
        }),
      },
      "Gemini 图片生成",
    );
    const blocks = [
      ...(payload.steps ?? []).flatMap((step) => step.content ?? []),
      ...(payload.outputs ?? []),
      ...(payload.output_image ? [payload.output_image] : []),
    ];
    const image = blocks.find((block) => block.type === "image" && block.data);
    if (!image?.data) throw new ImageProviderError("Gemini 没有返回图片内容。");
    return imageFromBase64(image.data, config.model, image.mime_type);
  },
  async test(config) {
    await requestStatus(
      endpoint(config.baseURL, `models/${encodeURIComponent(config.model)}`),
      { headers: { "x-goog-api-key": config.apiKey } },
      "Gemini 图片模型连接测试",
    );
    return { verification: "credentials" };
  },
};
