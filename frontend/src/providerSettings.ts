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
const DIRECTOR_MODEL_HEADER = "X-ChatVerse-Director-Model";
const NARRATOR_MODEL_HEADER = "X-ChatVerse-Narrator-Model";
const ACTOR_MODEL_HEADER = "X-ChatVerse-Actor-Model";
const STUDIO_MODEL_HEADER = "X-ChatVerse-Studio-Model";
const ROLE_PROVIDERS_HEADER = "X-ChatVerse-Role-Providers";
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
  directorModel: string;
  narratorModel: string;
  actorModel: string;
  studioModel: string;
  roleProviders: Partial<Record<ProviderRole, RoleProviderSettings>>;
  providerOptions: Record<string, unknown>;
  modelProfile?: ProviderModelProfile;
}

export type ProviderRole = "studio" | "director" | "narrator" | "actor";

export interface RoleProviderSettings {
  preset: ProviderPreset;
  protocol: ProviderProtocol;
  providerName: string;
  apiKey: string;
  baseURL: string;
  model: string;
  providerOptions: Record<string, unknown>;
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
  directorModel: getProviderPresetDefinition("deepseek").models[0].id,
  narratorModel: getProviderPresetDefinition("deepseek").models[0].id,
  actorModel: getProviderPresetDefinition("deepseek").models[0].id,
  studioModel: getProviderPresetDefinition("deepseek").models[0].id,
  roleProviders: {},
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
      directorModel: firstNonEmptyString(value.directorModel) || model,
      narratorModel: firstNonEmptyString(value.narratorModel) || model,
      actorModel: firstNonEmptyString(value.actorModel, (value as Record<string, unknown>).characterModel) || model,
      studioModel: firstNonEmptyString(value.studioModel, (value as Record<string, unknown>).authoringModel) || model,
      roleProviders: normalizeRoleProviders(value.roleProviders),
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
    directorModel: settings.directorModel.trim() || settings.model.trim(),
    narratorModel: settings.narratorModel.trim() || settings.model.trim(),
    actorModel: settings.actorModel.trim() || settings.model.trim(),
    studioModel: settings.studioModel.trim() || settings.model.trim(),
    roleProviders: normalizeRoleProviders(settings.roleProviders),
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
    & Partial<Pick<ProviderSettings, "directorModel" | "narratorModel" | "actorModel" | "studioModel" | "roleProviders">>
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
  if (settings.directorModel?.trim()) result[DIRECTOR_MODEL_HEADER] = settings.directorModel.trim();
  if (settings.narratorModel?.trim()) result[NARRATOR_MODEL_HEADER] = settings.narratorModel.trim();
  if (settings.actorModel?.trim()) result[ACTOR_MODEL_HEADER] = settings.actorModel.trim();
  if (settings.studioModel?.trim()) result[STUDIO_MODEL_HEADER] = settings.studioModel.trim();
  if ((settings as Partial<ProviderSettings>).roleProviders
    && Object.keys((settings as Partial<ProviderSettings>).roleProviders ?? {}).length > 0) {
    const roleProviders = (settings as Partial<ProviderSettings>).roleProviders ?? {};
    const payload = Object.fromEntries(Object.entries(roleProviders).map(([role, connection]) => [role, {
      protocol: connection?.protocol,
      providerName: connection?.providerName,
      apiKey: connection?.apiKey,
      baseURL: connection?.baseURL,
      model: connection?.model,
      providerOptions: connection?.providerOptions,
    }]));
    result[ROLE_PROVIDERS_HEADER] = encodeUtf8Header(JSON.stringify(payload));
  }
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

function normalizeRoleProviders(value: unknown): Partial<Record<ProviderRole, RoleProviderSettings>> {
  if (!isRecord(value)) return {};
  const result: Partial<Record<ProviderRole, RoleProviderSettings>> = {};
  for (const role of ["studio", "director", "narrator", "actor"] as const) {
    const raw = value[role];
    if (!isRecord(raw)) continue;
    const preset = isProviderPreset(raw.preset) ? raw.preset : "custom";
    const definition = getProviderPresetDefinition(preset);
    result[role] = {
      preset,
      protocol: isProviderProtocol(raw.protocol) ? raw.protocol : providerProtocol(definition),
      providerName: firstNonEmptyString(raw.providerName) || definition.providerName,
      apiKey: firstNonEmptyString(raw.apiKey),
      baseURL: firstNonEmptyString(raw.baseURL) || definition.baseURL,
      model: firstNonEmptyString(raw.model) || definition.models[0]?.id || "",
      providerOptions: mergeProviderOptions(definition.providerOptions, isRecord(raw.providerOptions) ? raw.providerOptions : undefined),
    };
  }
  return result;
}

function encodeUtf8Header(value: string): string {
  return `${UTF8_HEADER_PREFIX}${encodeURIComponent(value)}`;
}

function legacyProviderPreset(value: unknown): ProviderPreset | undefined {
  if (isProviderPreset(value)) return value;
  if (value === "openai-compatible") return "custom";
  return undefined;
}
