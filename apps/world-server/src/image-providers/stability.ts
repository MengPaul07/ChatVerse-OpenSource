import { ImageProviderError, type ImageProviderAdapter } from "./types.js";
import {
  assertSafeRemoteUrl,
  closestAspectRatio,
  endpoint,
  imageFromResponse,
  requestStatus,
} from "./shared.js";

export const stabilityImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    if (!/^[a-z0-9-]+$/i.test(config.model)) {
      throw new ImageProviderError("Stability 模型需要填写 core、ultra 或 sd3 等接口名称。");
    }
    const url = endpoint(config.baseURL, `v2beta/stable-image/generate/${config.model}`);
    assertSafeRemoteUrl(url);
    const body = new FormData();
    body.append("prompt", input.prompt);
    body.append("aspect_ratio", closestAspectRatio(input.size));
    body.append("output_format", "webp");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "image/*",
      },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    return imageFromResponse(response, config.model);
  },
  async test(config) {
    await requestStatus(endpoint(config.baseURL, "v1/user/account"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, "Stability AI 连接测试");
    return { verification: "credentials" };
  },
};
