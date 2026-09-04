import {
  getProviderPresetDefinition,
  getProviderModelProfile,
  isProviderPreset,
  providerProtocol,
  type ProviderPreset,
} from "./providerCatalog";
import type {
  ProviderCapabilities,
  ProviderModelProfile,
  ProviderProtocol,
} from "@chatverse/core";
import { isProviderProtocol } from "@chatverse/core";
import { readResearchProviderSettings, researchProviderRequestHeadersForSettings } from "./researchProviderSettings";

export type { ProviderPreset } from "./providerCatalog";
export type { ProviderProtocol } from "@chatverse/core";

const STORAGE_KEY = "chatverse:provider-settings";
const API_KEY_HEADER = "X-ChatVerse-API-Key";
const API_BASE_URL_HEADER = "X-ChatVerse-API-Base-URL";
const MODEL_HEADER = "X-ChatVerse-Model";
const PROTOCOL_HEADER = "X-ChatVerse-Protocol";
const PROVIDER_HEADER = "X-ChatVerse-Provider";
const PROVIDER_OPTIONS_HEADER = "X-ChatVerse-Provider-Options";
const MODEL_PROFILE_HEADER = "X-ChatVerse-Model-Profile";
const UTF8_HEADER_PREFIX = "chatverse-utf8:";

export interface ProviderSettings {
  preset: ProviderPreset;
  protocol: ProviderProtocol;
  providerName: string;
  apiKey: string;
  baseURL: string;
  model: string;
  providerOptions: Record<string, unknown>;
  modelProfile?: ProviderModelProfile;
}

type PersistedProviderSettings = Partial<ProviderSettings> & {
  /** Fields written by versions before the provider catalog was introduced. */
  provider?: unknown;
  apiURL?: unknown;
  apiUrl?: unknown;
  baseUrl?: unknown;
  api_base_url?: unknown;
  api_key?: unknown;
  modelId?: unknown;
  model_id?: unknown;
};

const EMPTY_SETTINGS: ProviderSettings = {
  preset: "deepseek",
  protocol: providerProtocol(getProviderPresetDefinition("deepseek")),
  providerName: getProviderPresetDefinition("deepseek").providerName,
  apiKey: "",
  baseURL: getProviderPresetDefinition("deepseek").baseURL,
  model: getProviderPresetDefinition("deepseek").models[0].id,
  providerOptions: getProviderPresetDefinition("deepseek").providerOptions ?? {},
  modelProfile: getProviderModelProfile(
    getProviderPresetDefinition("deepseek"),
    getProviderPresetDefinition("deepseek").models[0].id,
  ),
};

export function readProviderSettings(): ProviderSettings {
  if (typeof window === "undefined") return { ...EMPTY_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_SETTINGS };
    const value = JSON.parse(raw) as PersistedProviderSettings;
    const preset = isProviderPreset(value.preset)
      ? value.preset
      : legacyProviderPreset(value.provider) ?? EMPTY_SETTINGS.preset;
    const definition = getProviderPresetDefinition(preset);
    const storedProtocol = isProviderProtocol(value.protocol)
      ? value.protocol
      : providerProtocol(definition);
    const storedModel = firstNonEmptyString(value.model, value.modelId, value.model_id);
    const storedBaseURL = firstNonEmptyString(
      value.baseURL,
      value.apiURL,
      value.apiUrl,
      value.baseUrl,
      value.api_base_url,
    );
    const model = storedModel || definition.models[0]?.id || "";
    return {
      preset,
      protocol: storedProtocol,
      providerName: typeof value.providerName === "string" && value.providerName.trim()
        ? value.providerName.trim()
        : definition.providerName,
      apiKey: firstNonEmptyString(value.apiKey, value.api_key),
      baseURL: storedBaseURL || definition.baseURL,
      model,
      providerOptions: mergeProviderOptions(
        definition.providerOptions,
        isRecord(value.providerOptions) ? value.providerOptions : undefined,
      ),
      modelProfile: getProviderModelProfile(definition, model),
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

function mergeProviderOptions(
  defaults: Record<string, unknown> | undefined,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(defaults ?? {}), ...(stored ?? {}) };
  const namespaces = new Set([
    ...Object.keys(defaults ?? {}),
    ...Object.keys(stored ?? {}),
  ]);
  for (const namespace of namespaces) {
    const defaultValue = defaults?.[namespace];
    const storedValue = stored?.[namespace];
    if (isRecord(defaultValue) || isRecord(storedValue)) {
      result[namespace] = { ...(isRecord(defaultValue) ? defaultValue : {}), ...(isRecord(storedValue) ? storedValue : {}) };
    }
  }
  return result;
}

export function saveProviderSettings(settings: ProviderSettings): ProviderSettings {
  const next = {
    preset: settings.preset,
    protocol: settings.protocol,
    providerName: settings.providerName.trim(),
    apiKey: settings.apiKey.trim(),
    baseURL: settings.baseURL.trim(),
    model: settings.model.trim(),
    providerOptions: isRecord(settings.providerOptions) ? settings.providerOptions : {},
    modelProfile: settings.modelProfile
      ?? getProviderModelProfile(getProviderPresetDefinition(settings.preset), settings.model),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function clearProviderSettings(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

export function providerRequestHeadersForSettings(
  settings: Pick<ProviderSettings, "apiKey" | "baseURL" | "model">
    & Partial<Pick<ProviderSettings, "protocol" | "providerName" | "providerOptions" | "preset" | "modelProfile">>,
  headers?: HeadersInit,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { result[key] = value; });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[key] = value;
  } else if (headers) {
    Object.assign(result, headers);
  }
  if (settings.apiKey.trim()) result[API_KEY_HEADER] = settings.apiKey.trim();
  if (settings.baseURL.trim()) result[API_BASE_URL_HEADER] = settings.baseURL.trim();
  if (settings.model.trim()) result[MODEL_HEADER] = settings.model.trim();
  if (settings.protocol) result[PROTOCOL_HEADER] = settings.protocol;
  if (settings.providerName?.trim()) result[PROVIDER_HEADER] = encodeUtf8Header(settings.providerName.trim());
  if (settings.providerOptions && Object.keys(settings.providerOptions).length > 0) {
    result[PROVIDER_OPTIONS_HEADER] = encodeUtf8Header(JSON.stringify(settings.providerOptions));
  }
  if (settings.modelProfile) {
    result[MODEL_PROFILE_HEADER] = encodeUtf8Header(JSON.stringify(settings.modelProfile));
  } else if (settings.preset) {
    result[MODEL_PROFILE_HEADER] = encodeUtf8Header(JSON.stringify(
      getProviderModelProfile(getProviderPresetDefinition(settings.preset), settings.model),
    ));
  }
  return result;
}

export function providerRequestHeaders(
  headers?: HeadersInit,
): Record<string, string> {
  return researchProviderRequestHeadersForSettings(
    readResearchProviderSettings(),
    providerRequestHeadersForSettings(readProviderSettings(), headers),
  );
}

export interface ProviderConnectionTestResult {
  ok: true;
  providerName?: string;
  model?: string;
  protocol?: ProviderProtocol;
  capabilities?: ProviderCapabilities;
  modelProfile?: ProviderModelProfile;
}

export async function testProviderConnection(
  settings: Pick<ProviderSettings, "apiKey" | "baseURL" | "model">
    & Partial<Pick<ProviderSettings, "protocol" | "providerName" | "providerOptions" | "preset" | "modelProfile">>,
  signal?: AbortSignal,
): Promise<ProviderConnectionTestResult> {
  const response = await fetch("/api/v1/provider/test", {
    method: "POST",
    headers: providerRequestHeadersForSettings(settings, {
      "Content-Type": "application/json",
    }),
    body: "{}",
    signal,
  });
  const body = await response.json().catch(() => ({})) as {
    ok?: boolean;
    providerName?: string;
    model?: string;
    protocol?: ProviderProtocol;
    capabilities?: ProviderCapabilities;
    modelProfile?: ProviderModelProfile;
    message?: string;
  };
  if (!response.ok || body.ok !== true) {
    throw new Error(body.message || `模型连接测试失败（${response.status}）。`);
  }
  return {
    ok: true,
    providerName: body.providerName,
    model: body.model,
    protocol: body.protocol,
    capabilities: body.capabilities,
    modelProfile: body.modelProfile,
  };
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function encodeUtf8Header(value: string): string {
  return `${UTF8_HEADER_PREFIX}${encodeURIComponent(value)}`;
}

function legacyProviderPreset(value: unknown): ProviderPreset | undefined {
  if (isProviderPreset(value)) return value;
  if (value === "openai-compatible") return "custom";
  return undefined;
}
