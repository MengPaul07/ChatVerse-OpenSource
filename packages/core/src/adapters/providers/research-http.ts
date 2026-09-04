import { asRecord, errorMessage } from "./provider-utils.js";

export async function postResearchJson(input: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<unknown> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });
  const value = await response.json().catch(() => undefined);
  if (response.ok) return value;
  const record = asRecord(value);
  const detail = asRecord(record?.detail);
  const nestedError = asRecord(record?.error);
  const message = typeof record?.message === "string" ? record.message
    : typeof detail?.error === "string" ? detail.error
      : typeof nestedError?.message === "string" ? nestedError.message
        : `Research provider returned HTTP ${response.status}.`;
  throw Object.assign(new Error(message), { status: response.status });
}

export function researchEndpoint(baseURL: string, path: string): string {
  try {
    return new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
  } catch (error) {
    throw new Error(`Invalid research provider base URL: ${errorMessage(error)}`);
  }
}

export function limitedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

export function numberOption(
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = options?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
}

export function stringOption<T extends string>(
  options: Record<string, unknown> | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = options?.[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}
