import { providerRequestHeaders } from "../../../providerSettings";
import type { AuthoringApiResponse } from "./contracts";

export async function authoringRequest(
  path: string,
  init?: RequestInit,
): Promise<AuthoringApiResponse> {
  const response = await fetch(path, {
    ...init,
    headers: providerRequestHeaders({
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    }),
  });
  const body = await response.json().catch(() => ({
    ok: false,
    message: `服务返回了无法解析的响应（${response.status}）。`,
  })) as AuthoringApiResponse;
  if (!response.ok) throw new Error(body.message || "操作失败。");
  return body;
}

export function parseAuthoringEvent(event: Event): {
  data?: Record<string, unknown>;
} | undefined {
  if (!(event instanceof MessageEvent)) return undefined;
  try {
    return JSON.parse(event.data) as { data?: Record<string, unknown> };
  } catch {
    return undefined;
  }
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function studioValidationMessage(message: string): string {
  return message
    .replaceAll("AI Actor", "AI 角色")
    .replaceAll("Director", "故事引擎")
    .replaceAll("Actor", "角色")
    .replaceAll("Agent", "创作助手");
}
