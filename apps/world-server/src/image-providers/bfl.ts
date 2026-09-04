import { ImageProviderError, type ImageProviderAdapter } from "./types.js";
import {
  imageFromUrl,
  endpoint,
  parsePixelSize,
  requestJson,
  requestStatus,
} from "./shared.js";

interface BflTaskCreated {
  id?: string;
  polling_url?: string;
}

interface BflTaskResult {
  status?: string;
  result?: { sample?: string };
}

export const bflImageAdapter: ImageProviderAdapter = {
  async generate(config, input) {
    const { width, height } = parsePixelSize(input.size);
    const created = await requestJson<BflTaskCreated>(
      endpoint(config.baseURL, `v1/${encodeURIComponent(config.model)}`),
      {
        method: "POST",
        headers: bflHeaders(config.apiKey, true),
        body: JSON.stringify({ prompt: input.prompt, width, height }),
      },
      "FLUX 图片任务创建",
    );
    if (!created.polling_url) throw new ImageProviderError("FLUX 没有返回任务查询地址。");

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await delay(500);
      const result = await requestJson<BflTaskResult>(
        created.polling_url,
        { headers: bflHeaders(config.apiKey, false) },
        "FLUX 图片任务查询",
      );
      if (result.status === "Ready" && result.result?.sample) {
        return imageFromUrl(result.result.sample, config.model);
      }
      if (["Error", "Failed", "Request Moderated", "Content Moderated"].includes(result.status ?? "")) {
        throw new ImageProviderError(`FLUX 图片任务未完成：${result.status ?? "unknown"}。`);
      }
    }
    throw new ImageProviderError("FLUX 图片任务等待超时，请稍后重试。");
  },
  async test(config) {
    await requestStatus(endpoint(config.baseURL, "v1/credits"), {
      headers: bflHeaders(config.apiKey, false),
    }, "Black Forest Labs 连接测试");
    return { verification: "credentials" };
  },
};

function bflHeaders(apiKey: string, json: boolean): Record<string, string> {
  return {
    "x-key": apiKey,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
