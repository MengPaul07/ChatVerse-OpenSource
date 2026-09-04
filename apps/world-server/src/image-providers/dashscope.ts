import { ImageProviderError, type ImageProviderAdapter } from "./types.js";
import {
  endpoint,
  imageFromUrl,
  parsePixelSize,
  requestJson,
  requestStatus,
} from "./shared.js";

interface DashScopeResponse {
  output?: {
    choices?: Array<{ message?: { content?: Array<{ image?: string }> } }>;
    results?: Array<{ url?: string }>;
  };
}

export const dashScopeImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    const { width, height } = parsePixelSize(input.size);
    const payload = await requestJson<DashScopeResponse>(
      endpoint(config.baseURL, "api/v1/services/aigc/multimodal-generation/generation"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          input: {
            messages: [{ role: "user", content: [{ text: input.prompt }] }],
          },
          parameters: {
            n: 1,
            size: `${width}*${height}`,
            watermark: false,
          },
        }),
      },
      "阿里云百炼图片生成",
    );
    const url = payload.output?.choices?.flatMap((choice) => choice.message?.content ?? [])
      .find((item) => item.image)?.image
      ?? payload.output?.results?.find((item) => item.url)?.url;
    if (!url) throw new ImageProviderError("阿里云百炼没有返回图片地址。");
    return imageFromUrl(url, config.model);
  },
  async test(config) {
    await requestStatus(
      endpoint(config.baseURL, "api/v1/tasks/chatverse-connection-test"),
      { headers: { Authorization: `Bearer ${config.apiKey}` } },
      "阿里云百炼连接测试",
      [400, 404],
    );
    return { verification: "endpoint" };
  },
};
