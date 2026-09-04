import { describe, expect, it } from "vitest";
import type { ChatProvider, WebResearchProvider } from "@chatverse/core";
import type { ProviderPair } from "./rooms/contracts.js";
import { ProviderRuntime } from "./provider-runtime.js";

function chatProvider(label: string): ChatProvider {
  return {
    async complete() {
      return label;
    },
    async *stream() {
      yield label;
    },
    async chat() {
      return { content: label, toolCalls: [] };
    },
  };
}

function researchProvider(label: string): WebResearchProvider {
  return {
    async search() {
      return { summary: label, sources: [] };
    },
  };
}

function pair(label: string, research = false): ProviderPair {
  return {
    directorProvider: chatProvider(`${label}:director`),
    characterProvider: chatProvider(`${label}:character`),
    authoringProvider: chatProvider(`${label}:authoring`),
    ...(research ? { researchProvider: researchProvider(`${label}:research`) } : {}),
  };
}

describe("ProviderRuntime", () => {
  it("switches stable provider references when request settings change", async () => {
    const calls: string[] = [];
    const runtime = new ProviderRuntime(
      pair("initial", true),
      async (config) => {
        calls.push(config?.baseURL ?? "");
        return pair(config?.model ?? "updated");
      },
      { baseURL: "https://initial.example/v1", model: "initial" },
    );

    expect(await runtime.providers.directorProvider.complete({
      systemPrompt: "",
      userPrompt: "",
    })).toBe("initial:director");

    await runtime.update({ baseURL: "https://new.example/v1", model: "new-model" });

    expect(calls).toEqual(["https://new.example/v1"]);
    expect(await runtime.providers.directorProvider.complete({
      systemPrompt: "",
      userPrompt: "",
    })).toBe("new-model:director");
    expect(await runtime.providers.authoringProvider!.complete({
      systemPrompt: "",
      userPrompt: "",
    })).toBe("new-model:authoring");
    expect((runtime.providers.researchProvider as WebResearchProvider & { available: boolean }).available).toBe(false);

    await runtime.update({ baseURL: "https://new.example/v1", model: "new-model" });
    expect(calls).toHaveLength(1);
  });

  it("keeps a failed replacement retryable", async () => {
    let attempts = 0;
    const runtime = new ProviderRuntime(
      pair("initial"),
      async (config) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary provider failure");
        return pair(config?.model ?? "updated");
      },
      { model: "initial" },
    );

    await expect(runtime.update({ model: "new-model" })).rejects.toThrow("temporary provider failure");
    await runtime.update({ model: "new-model" });
    expect(await runtime.providers.characterProvider.complete({
      systemPrompt: "",
      userPrompt: "",
    })).toBe("new-model:character");
  });
});
