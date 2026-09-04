import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearProviderSettings,
  providerRequestHeaders,
  providerRequestHeadersForSettings,
  readProviderSettings,
} from "./providerSettings";

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
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

describe("provider settings", () => {
  it("uses the current DeepSeek default when no local configuration exists", () => {
    const settings = readProviderSettings();

    expect(settings.preset).toBe("deepseek");
    expect(settings.baseURL).toBe("https://api.deepseek.com");
    expect(settings.model).toBe("deepseek-v4-flash");
    expect(settings.protocol).toBe("openai-chat");
    expect(settings.providerOptions).toMatchObject({
      openai: { thinking: true, reasoningEffort: true },
    });
  });

  it("forwards the selected provider, model, and caller headers together", () => {
    storage.set("chatverse:provider-settings", JSON.stringify({
      preset: "moonshot",
      providerName: "Moonshot",
      apiKey: "secret",
      baseURL: "https://api.moonshot.cn/v1",
      model: "kimi-k3",
    }));

    const headers = providerRequestHeaders({ "Content-Type": "application/json" });
    expect(headers).toMatchObject({
      "Content-Type": "application/json",
      "X-ChatVerse-API-Key": "secret",
      "X-ChatVerse-API-Base-URL": "https://api.moonshot.cn/v1",
      "X-ChatVerse-Model": "kimi-k3",
      "X-ChatVerse-Protocol": "openai-chat",
      "X-ChatVerse-Provider": "chatverse-utf8:Moonshot",
    });
    expect(headers["X-ChatVerse-Model-Profile"]).toMatch(/^chatverse-utf8:/);
  });

  it("keeps legacy API URL settings instead of falling back to DeepSeek", () => {
    storage.set("chatverse:provider-settings", JSON.stringify({
      provider: "custom",
      apiKey: "legacy-secret",
      apiURL: "https://legacy.example.test/v1",
      model: "legacy-model",
    }));

    expect(readProviderSettings()).toMatchObject({
      preset: "custom",
      apiKey: "legacy-secret",
      baseURL: "https://legacy.example.test/v1",
      model: "legacy-model",
    });
    expect(providerRequestHeaders()).toMatchObject({
      "X-ChatVerse-API-Base-URL": "https://legacy.example.test/v1",
    });
  });

  it("builds request headers from an unsaved candidate", () => {
    storage.set("chatverse:provider-settings", JSON.stringify({
      apiKey: "old-secret",
      baseURL: "https://old.example.test/v1",
      model: "old-model",
    }));

    expect(providerRequestHeadersForSettings({
      apiKey: " new-secret ",
      baseURL: " https://new.example.test/v1 ",
      model: " new-model ",
      protocol: "anthropic-messages",
      providerName: "智谱 AI ",
      providerOptions: { anthropic: { extendedThinking: true, label: "中文配置" } },
    })).toEqual({
      "X-ChatVerse-API-Key": "new-secret",
      "X-ChatVerse-API-Base-URL": "https://new.example.test/v1",
      "X-ChatVerse-Model": "new-model",
      "X-ChatVerse-Protocol": "anthropic-messages",
      "X-ChatVerse-Provider": "chatverse-utf8:%E6%99%BA%E8%B0%B1%20AI",
      "X-ChatVerse-Provider-Options": "chatverse-utf8:%7B%22anthropic%22%3A%7B%22extendedThinking%22%3Atrue%2C%22label%22%3A%22%E4%B8%AD%E6%96%87%E9%85%8D%E7%BD%AE%22%7D%7D",
    });
    expect(readProviderSettings().apiKey).toBe("old-secret");
  });

  it("defaults a persisted configuration without protocol to OpenAI Chat", () => {
    storage.set("chatverse:provider-settings", JSON.stringify({
      preset: "custom",
      apiKey: "secret",
      baseURL: "https://example.test/v1",
      model: "model",
    }));

    expect(readProviderSettings().protocol).toBe("openai-chat");
  });

  it("merges new preset protocol options into an existing saved Zhipu configuration", () => {
    storage.set("chatverse:provider-settings", JSON.stringify({
      preset: "zhipu",
      apiKey: "secret",
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-5.3-flash",
      providerOptions: {},
    }));

    expect(readProviderSettings().providerOptions).toMatchObject({
      openai: { toolChoice: "auto" },
    });
  });

  it("clears only the ChatVerse provider record", () => {
    storage.set("chatverse:provider-settings", "{}");
    storage.set("unrelated-site-setting", "keep");

    clearProviderSettings();

    expect(storage.has("chatverse:provider-settings")).toBe(false);
    expect(storage.get("unrelated-site-setting")).toBe("keep");
  });
});
