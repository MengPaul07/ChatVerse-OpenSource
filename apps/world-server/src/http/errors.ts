import { ImageProviderError } from "../image-providers/index.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function imageProviderHttpError(code: string, error: unknown): HttpError {
  if (error instanceof ImageProviderError) return new HttpError(502, code, error.message);
  console.error("Image provider adapter failed:", error instanceof Error ? error.message : error);
  return new HttpError(502, code, "图片服务请求失败，请检查图片模型配置或稍后重试。");
}
