import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearResearchProviderSettings,
  readResearchProviderSettings,
  researchProviderRequestHeadersForSettings,
  saveResearchProviderSettings,
} from "./researchProviderSettings";

const storage = new Map<string, string>();
const originalWindow = (globalThis as { window?: unknown }).window;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } },
});

beforeEach(() => storage.clear());
afterAll(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("research provider settings", () => {
  it("uses a dedicated Tavily preset without borrowing text credentials", () => {
    expect(readResearchProviderSettings()).toMatchObject({
      preset: "tavily",
      protocol: "tavily-search",
      baseURL: "https://api.tavily.com",
      apiKey: "",
    });
  });

  it("persists and emits only research-specific headers", () => {
    const saved = saveResearchProviderSettings({
      preset: "zhipu",
      protocol: "zhipu-web-search",
      providerName: "智谱 AI",
      apiKey: " research-key ",
      baseURL: " https://open.bigmodel.cn ",
      model: "search_pro",
      options: { count: 12 },
    });
    const headers = researchProviderRequestHeadersForSettings(saved, { "X-ChatVerse-Model": "text-model" });

    expect(headers).toMatchObject({
      "X-ChatVerse-Model": "text-model",
      "X-ChatVerse-Research-Protocol": "zhipu-web-search",
      "X-ChatVerse-Research-API-Key": "research-key",
      "X-ChatVerse-Research-API-Base-URL": "https://open.bigmodel.cn",
      "X-ChatVerse-Research-Model": "search_pro",
    });
    expect(headers["X-ChatVerse-Research-Provider"]).toContain("chatverse-utf8:");
    expect(headers["X-ChatVerse-API-Key"]).toBeUndefined();
  });

  it("clears research settings without touching text settings", () => {
    storage.set("chatverse:research-provider-settings", "{}");
    storage.set("chatverse:provider-settings", "keep");
    clearResearchProviderSettings();
    expect(storage.has("chatverse:research-provider-settings")).toBe(false);
    expect(storage.get("chatverse:provider-settings")).toBe("keep");
  });
});
