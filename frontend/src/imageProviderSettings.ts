import {
  getImageProviderPresetDefinition,
  isImageProviderPreset,
  isImageProviderProtocol,
  type ImageProviderPreset,
  type ImageProviderProtocol,
} from "./imageProviderCatalog";

export const IMAGE_PROVIDER_SETTINGS_STORAGE_KEY = "chatverse:image-provider-settings:v1";

export interface ImageProviderSettings {
  preset: ImageProviderPreset;
  protocol: ImageProviderProtocol;
  providerName: string;
  apiKey: string;
  baseURL: string;
  model: string;
  landscapeSize: string;
  portraitSize: string;
}

const DEFAULT_DEFINITION = getImageProviderPresetDefinition("openai");
const DEFAULT_SETTINGS: ImageProviderSettings = {
  preset: DEFAULT_DEFINITION.id,
  protocol: DEFAULT_DEFINITION.protocol,
  providerName: DEFAULT_DEFINITION.providerName,
  apiKey: "",
  baseURL: DEFAULT_DEFINITION.baseURL,
  model: DEFAULT_DEFINITION.models[0]?.id ?? "",
  landscapeSize: DEFAULT_DEFINITION.landscapeSizes[0] ?? "1536x1024",
  portraitSize: DEFAULT_DEFINITION.portraitSizes[0] ?? "1024x1536",
};

export function readImageProviderSettings(): ImageProviderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(IMAGE_PROVIDER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const value = JSON.parse(raw) as Partial<ImageProviderSettings>;
    const inferredPreset = inferPreset(value.baseURL);
    const preset = isImageProviderPreset(value.preset) ? value.preset : inferredPreset;
    const definition = getImageProviderPresetDefinition(preset);
    return {
      preset,
      protocol: isImageProviderProtocol(value.protocol) ? value.protocol : definition.protocol,
      providerName: clean(value.providerName) || definition.providerName,
      apiKey: typeof value.apiKey === "string" ? value.apiKey.trim() : "",
      baseURL: clean(value.baseURL) || definition.baseURL,
      model: clean(value.model) || definition.models[0]?.id || "",
      landscapeSize: clean(value.landscapeSize) || definition.landscapeSizes[0] || "1536x1024",
      portraitSize: clean(value.portraitSize) || definition.portraitSizes[0] || "1024x1536",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveImageProviderSettings(settings: ImageProviderSettings): ImageProviderSettings {
  const next = normalizeImageProviderSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(IMAGE_PROVIDER_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function normalizeImageProviderSettings(settings: ImageProviderSettings): ImageProviderSettings {
  const definition = getImageProviderPresetDefinition(settings.preset);
  return {
    preset: settings.preset,
    protocol: definition.protocol,
    providerName: settings.providerName.trim() || definition.providerName,
    apiKey: settings.apiKey.trim(),
    baseURL: normalizeImageBaseURL(settings.baseURL),
    model: settings.model.trim(),
    landscapeSize: settings.landscapeSize.trim(),
    portraitSize: settings.portraitSize.trim(),
  };
}

export function clearImageProviderSettings(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(IMAGE_PROVIDER_SETTINGS_STORAGE_KEY);
  }
}

export function imageProviderHeaders(settings = readImageProviderSettings()): HeadersInit {
  return {
    "X-ChatVerse-Image-API-Key": settings.apiKey,
    "X-ChatVerse-Image-API-Base-URL": settings.baseURL,
    "X-ChatVerse-Image-Model": settings.model,
    "X-ChatVerse-Image-Protocol": settings.protocol,
  };
}

export interface ImageProviderConnectionTestResult {
  ok: true;
  model?: string;
  protocol?: ImageProviderProtocol;
  verification?: "credentials" | "endpoint";
}

export async function testImageProviderConnection(
  settings: ImageProviderSettings,
  signal?: AbortSignal,
): Promise<ImageProviderConnectionTestResult> {
  const normalized = normalizeImageProviderSettings(settings);
  const response = await fetch("/api/v1/image-provider/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...imageProviderHeaders(normalized),
    },
    body: "{}",
    signal,
  });
  const body = await response.json().catch(() => ({})) as {
    ok?: boolean;
    model?: string;
    protocol?: ImageProviderProtocol;
    verification?: "credentials" | "endpoint";
    message?: string;
  };
  if (!response.ok || body.ok !== true) {
    throw new Error(body.message || `图片模型连接测试失败（${response.status}）。`);
  }
  return { ok: true, model: body.model, protocol: body.protocol, verification: body.verification };
}

function inferPreset(baseURL: unknown): ImageProviderPreset {
  if (typeof baseURL !== "string") return "openai";
  if (baseURL.includes("api.openai.com")) return "openai";
  if (baseURL.includes("cf.api.fan") || baseURL.includes("packyapi.ai")) return "packyapi";
  return "custom-openai";
}

function normalizeImageBaseURL(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() === "cf.api.fan" && (url.pathname === "" || url.pathname === "/")) {
      url.pathname = "/v1";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
