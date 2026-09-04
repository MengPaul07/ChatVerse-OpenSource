import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearImageProviderSettings,
  imageProviderHeaders,
  normalizeImageProviderSettings,
  readImageProviderSettings,
  saveImageProviderSettings,
} from "./imageProviderSettings";

const storage = new Map<string, string>();
const originalWindow = (globalThis as { window?: unknown }).window;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
});

beforeEach(() => storage.clear());

afterAll(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("image provider settings", () => {
  it("uses OpenAI image defaults before the user configures a provider", () => {
    expect(readImageProviderSettings()).toMatchObject({
      preset: "openai",
      protocol: "openai",
      model: "gpt-image-2",
      landscapeSize: "1536x1024",
    });
  });

  it("persists the selected native protocol and forwards it to the server", () => {
    const saved = saveImageProviderSettings({
      preset: "bfl",
      protocol: "openai",
      providerName: "Black Forest Labs",
      apiKey: " secret ",
      baseURL: "https://api.bfl.ai/",
      model: "flux-2-pro",
      landscapeSize: "1440x810",
      portraitSize: "810x1440",
    });

    expect(saved.protocol).toBe("bfl");
    expect(saved.baseURL).toBe("https://api.bfl.ai");
    expect(imageProviderHeaders(saved)).toMatchObject({
      "X-ChatVerse-Image-Protocol": "bfl",
      "X-ChatVerse-Image-API-Key": "secret",
    });
  });

  it("normalizes the PackyAPI root address to its Images API base path", () => {
    const normalized = normalizeImageProviderSettings({
      preset: "packyapi",
      protocol: "openai",
      providerName: "PackyAPI",
      apiKey: "secret",
      baseURL: "https://cf.api.fan/",
      model: "gpt-image-2",
      landscapeSize: "1536x1024",
      portraitSize: "1024x1536",
    });

    expect(normalized.baseURL).toBe("https://cf.api.fan/v1");
    expect(normalized.protocol).toBe("openai");
  });

  it("clears only the image provider record", () => {
    storage.set("chatverse:image-provider-settings:v1", "{}");
    storage.set("chatverse:provider-settings", "keep");
    clearImageProviderSettings();
    expect(storage.has("chatverse:image-provider-settings:v1")).toBe(false);
    expect(storage.get("chatverse:provider-settings")).toBe("keep");
  });
});
