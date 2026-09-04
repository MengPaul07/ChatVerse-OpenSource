import { isWebResearchProtocol, type WebResearchProtocol } from "@chatverse/core";
import {
  getResearchProviderPreset,
  isResearchProviderPreset,
  type ResearchProviderPreset,
} from "./researchProviderCatalog";

const STORAGE_KEY = "chatverse:research-provider-settings";
const UTF8_HEADER_PREFIX = "chatverse-utf8:";

export interface ResearchProviderSettings {
  preset: ResearchProviderPreset;
  protocol: WebResearchProtocol;
  providerName: string;
  apiKey: string;
  baseURL: string;
  model: string;
  options: Record<string, unknown>;
}

const DEFAULT_PRESET = getResearchProviderPreset("tavily");
const EMPTY_SETTINGS: ResearchProviderSettings = {
  preset: DEFAULT_PRESET.id,
  protocol: DEFAULT_PRESET.protocol,
  providerName: DEFAULT_PRESET.providerName,
  apiKey: "",
  baseURL: DEFAULT_PRESET.baseURL,
  model: DEFAULT_PRESET.defaultModel ?? "",
  options: DEFAULT_PRESET.options ?? {},
};

export function readResearchProviderSettings(): ResearchProviderSettings {
  if (typeof window === "undefined") return { ...EMPTY_SETTINGS };
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<ResearchProviderSettings> | null;
    if (!value) return { ...EMPTY_SETTINGS };
    const preset = isResearchProviderPreset(value.preset) ? value.preset : EMPTY_SETTINGS.preset;
    const definition = getResearchProviderPreset(preset);
    return {
      preset,
      protocol: isWebResearchProtocol(value.protocol) ? value.protocol : definition.protocol,
      providerName: clean(value.providerName) || definition.providerName,
      apiKey: clean(value.apiKey),
      baseURL: clean(value.baseURL) || definition.baseURL,
      model: clean(value.model) || definition.defaultModel || "",
      options: isRecord(value.options) ? value.options : definition.options ?? {},
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

export function saveResearchProviderSettings(settings: ResearchProviderSettings): ResearchProviderSettings {
  const next = {
    ...settings,
    providerName: settings.providerName.trim(),
    apiKey: settings.apiKey.trim(),
    baseURL: settings.baseURL.trim(),
    model: settings.model.trim(),
    options: isRecord(settings.options) ? settings.options : {},
  };
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearResearchProviderSettings(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

export function researchProviderRequestHeadersForSettings(
  settings: ResearchProviderSettings,
  headers: Record<string, string> = {},
): Record<string, string> {
  const result = { ...headers };
  if (!settings.apiKey.trim() || !settings.baseURL.trim()) return result;
  result["X-ChatVerse-Research-Protocol"] = settings.protocol;
  result["X-ChatVerse-Research-Provider"] = encodeHeader(settings.providerName.trim());
  result["X-ChatVerse-Research-API-Key"] = settings.apiKey.trim();
  result["X-ChatVerse-Research-API-Base-URL"] = settings.baseURL.trim();
  if (settings.model.trim()) result["X-ChatVerse-Research-Model"] = settings.model.trim();
  if (Object.keys(settings.options).length) {
    result["X-ChatVerse-Research-Provider-Options"] = encodeHeader(JSON.stringify(settings.options));
  }
  return result;
}

export async function testResearchProviderConnection(
  settings: ResearchProviderSettings,
  baseHeaders: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: true; protocol?: WebResearchProtocol; providerName?: string; model?: string; sourceCount?: number }> {
  const response = await fetch("/api/v1/provider/research-test", {
    method: "POST",
    headers: researchProviderRequestHeadersForSettings(settings, { ...baseHeaders, "Content-Type": "application/json" }),
    body: "{}",
    signal,
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || body.ok !== true) throw new Error(typeof body.message === "string" ? body.message : `联网连接测试失败（${response.status}）。`);
  return {
    ok: true,
    protocol: isWebResearchProtocol(body.protocol) ? body.protocol : undefined,
    providerName: typeof body.providerName === "string" ? body.providerName : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    sourceCount: typeof body.sourceCount === "number" ? body.sourceCount : undefined,
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function encodeHeader(value: string): string {
  return `${UTF8_HEADER_PREFIX}${encodeURIComponent(value)}`;
}
