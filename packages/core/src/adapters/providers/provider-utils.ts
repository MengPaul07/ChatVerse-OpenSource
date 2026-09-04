import type { ProviderProtocol, WebResearchProtocol } from "../../contracts/provider.js";
import { normalizeProviderError, type ProviderRequestError } from "./provider-errors.js";

export interface RequestSignal {
  signal?: AbortSignal;
  /** Refresh the inactivity timeout after receiving provider progress. */
  touch(): void;
  cleanup(): void;
  wrapError(error: unknown): Error;
}

/**
 * SDK timeouts do not consistently cover custom gateways or stalled sockets,
 * so every protocol driver uses the same adapter-level cancellation wrapper.
 */
export function createRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
): RequestSignal {
  if (timeoutMs === undefined) {
    return {
      signal: parent,
      touch: () => undefined,
      cleanup: () => undefined,
      wrapError: asError,
    };
  }
  const controller = new AbortController();
  let timedOut = false;
  let closed = false;
  let timeout: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timeout);
    if (closed || controller.signal.aborted) return;
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };
  arm();
  const abortFromParent = () => controller.abort();
  parent?.addEventListener("abort", abortFromParent, { once: true });
  if (parent?.aborted) controller.abort();
  return {
    signal: controller.signal,
    touch: arm,
    cleanup: () => {
      closed = true;
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
    wrapError: (error) => timedOut
      ? new Error(`Provider request timed out after ${timeoutMs}ms: ${errorMessage(error)}`)
      : asError(error),
  };
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function wrapProviderError(
  error: unknown,
  context: { protocol: ProviderProtocol | WebResearchProtocol; provider?: string; model?: string },
): ProviderRequestError {
  return normalizeProviderError(error, context);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function reportUsage(
  listener: ((usage: import("../../contracts/provider.js").TokenUsage) => void) | undefined,
  usage: import("../../contracts/provider.js").TokenUsage | undefined,
): void {
  if (!listener || !usage) return;
  try {
    listener(usage);
  } catch {
    // Usage observers cannot break a successful model response.
  }
}

/**
 * Remove JSON Schema keywords that a provider profile explicitly says it
 * cannot accept.  The wire shape is shared by every tool-capable protocol;
 * only the surrounding tool envelope differs between adapters.
 */
export function sanitizeToolSchema(
  schema: Record<string, unknown>,
  compatibility: import("../../contracts/provider.js").ProviderCompatibility,
): Record<string, unknown> {
  if (compatibility.supportsFullJsonSchema !== false) return schema;
  const unsupported = new Set([
    "$schema",
    "$defs",
    "definitions",
    "$ref",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "dependentRequired",
    "dependentSchemas",
    "patternProperties",
    "unevaluatedItems",
    "unevaluatedProperties",
    "const",
  ]);
  return cleanSchemaValue(schema, unsupported) as Record<string, unknown>;
}

function cleanSchemaValue(value: unknown, unsupported: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => cleanSchemaValue(item, unsupported));
  if (!value || typeof value !== "object") return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (unsupported.has(key)) continue;
    cleaned[key] = cleanSchemaValue(nested, unsupported);
  }
  return cleaned;
}
