import { isIP } from "node:net";
import {
  ImageProviderError,
  type GeneratedImage,
} from "./types.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// High-resolution image gateways can legitimately take several minutes. Keep
// this above the provider's common 60-120 second generation window; nginx has
// a longer upstream timeout and the browser request remains cancellable.
const REQUEST_TIMEOUT_MS = 300_000;

export function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  operation: string,
): Promise<T> {
  assertSafeRemoteUrl(url);
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw providerResponseError(operation, response.status);
  try {
    return await response.json() as T;
  } catch {
    throw new ImageProviderError(`${operation}返回了无法解析的数据。`);
  }
}

export async function requestStatus(
  url: string,
  init: RequestInit,
  operation: string,
  acceptedStatuses: readonly number[] = [],
): Promise<number> {
  assertSafeRemoteUrl(url);
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw providerResponseError(operation, response.status);
  }
  return response.status;
}

export async function imageFromResponse(
  response: Response,
  model: string,
  revisedPrompt?: string,
): Promise<GeneratedImage> {
  if (!response.ok) throw providerResponseError("图片生成", response.status);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new ImageProviderError("生成图片超过 10 MB 限制。");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return imageFromBytes(bytes, response.headers.get("content-type") ?? undefined, model, revisedPrompt);
}

export function imageFromBase64(
  value: string,
  model: string,
  contentType?: string,
  revisedPrompt?: string,
): GeneratedImage {
  const bytes = Buffer.from(value, "base64");
  return imageFromBytes(bytes, contentType, model, revisedPrompt);
}

export async function imageFromUrl(
  url: string,
  model: string,
  revisedPrompt?: string,
): Promise<GeneratedImage> {
  assertSafeRemoteUrl(url);
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return imageFromResponse(response, model, revisedPrompt);
}

export function parsePixelSize(size: string): { width: number; height: number } {
  const match = /^(\d{2,5})[x*](\d{2,5})$/i.exec(size.trim());
  if (!match) throw new ImageProviderError("图片尺寸需要使用“宽x高”格式。 ");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 256 || height < 256 || width > 8192 || height > 8192) {
    throw new ImageProviderError("图片宽高需要在 256 到 8192 像素之间。");
  }
  return { width, height };
}

export function closestAspectRatio(size: string): string {
  const { width, height } = parsePixelSize(size);
  const target = width / height;
  const ratios = [
    ["21:9", 21 / 9],
    ["16:9", 16 / 9],
    ["3:2", 3 / 2],
    ["5:4", 5 / 4],
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
    ["9:21", 9 / 21],
  ] as const;
  return ratios.reduce((best, candidate) => (
    Math.abs(candidate[1] - target) < Math.abs(best[1] - target) ? candidate : best
  ))[0];
}

export function imageSizeTier(size: string): "1K" | "2K" | "4K" {
  const { width, height } = parsePixelSize(size);
  const longest = Math.max(width, height);
  if (longest > 2800) return "4K";
  if (longest > 1600) return "2K";
  return "1K";
}

export function assertSafeRemoteUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ImageProviderError("图片 API 地址无效。");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ImageProviderError("图片 API 必须使用不含账号密码的 HTTPS 地址。");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isPrivateAddress(host)) {
    throw new ImageProviderError("图片 API 不能指向本机或内网地址。");
  }
}

export function providerResponseError(operation: string, status: number): ImageProviderError {
  if (status === 401 || status === 403) {
    return new ImageProviderError(`${operation}未通过鉴权，请检查 API Key 与账户权限。`, status);
  }
  if (status === 404) {
    return new ImageProviderError(`${operation}找不到接口或模型，请检查 Base URL 与模型名称。`, status);
  }
  if (status === 429) {
    return new ImageProviderError(`${operation}受到限流或账户额度不足。`, status);
  }
  return new ImageProviderError(`${operation}失败，图片服务返回 ${status}。`, status);
}

function imageFromBytes(
  bytes: Buffer,
  contentType: string | undefined,
  model: string,
  revisedPrompt?: string,
): GeneratedImage {
  if (bytes.byteLength === 0) throw new ImageProviderError("图片服务返回了空文件。");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageProviderError("生成图片超过 10 MB 限制。");
  return { bytes, mimeType: detectMime(bytes, contentType), model, revisedPrompt };
}

function detectMime(bytes: Buffer, contentType?: string): GeneratedImage["mimeType"] {
  if (contentType?.startsWith("image/png") || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (contentType?.startsWith("image/jpeg") || (bytes[0] === 0xff && bytes[1] === 0xd8)) return "image/jpeg";
  if (contentType?.startsWith("image/webp") || bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new ImageProviderError("图片服务返回的文件不是 PNG、JPEG 或 WebP。");
}

function isPrivateAddress(host: string): boolean {
  if (!isIP(host)) return false;
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [first = -1, second = -1] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}
