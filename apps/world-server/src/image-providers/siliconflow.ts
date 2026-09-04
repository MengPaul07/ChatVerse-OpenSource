import { ImageProviderError, type ImageProviderAdapter } from "./types.js";
import {
  endpoint,
  imageFromUrl,
  requestJson,
  requestStatus,
} from "./shared.js";

interface SiliconFlowResponse {
  images?: Array<{ url?: string }>;
}

export const siliconFlowImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    const payload = await requestJson<SiliconFlowResponse>(
      endpoint(config.baseURL, "images/generations"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          prompt: input.prompt,
          image_size: input.size,
          batch_size: 1,
        }),
      },
      "硅基流动图片生成",
    );
    const url = payload.images?.find((image) => image.url)?.url;
    if (!url) throw new ImageProviderError("硅基流动没有返回图片地址。");
    return imageFromUrl(url, config.model);
  },
  async test(config) {
    await requestStatus(endpoint(config.baseURL, "models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, "硅基流动连接测试");
    return { verification: "credentials" };
  },
};
