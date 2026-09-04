import { describe, expect, it } from "vitest";
import {
  getProviderPresetDefinition,
  getProviderModelProfile,
  isProviderPreset,
  providerCapabilities,
  providerProtocol,
  PROVIDER_PRESETS,
} from "./providerCatalog";

describe("provider catalog", () => {
  it("contains unique presets with usable defaults", () => {
    const ids = PROVIDER_PRESETS.map((definition) => definition.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of PROVIDER_PRESETS.filter((item) => item.id !== "custom")) {
      expect(definition.baseURL).toMatch(/^https:\/\//);
      expect(definition.models.length).toBeGreaterThan(0);
      expect(definition.models[0].id).toBeTruthy();
    }
  });

  it("recognizes persisted preset ids and keeps custom as an escape hatch", () => {
    expect(isProviderPreset("moonshot")).toBe(true);
    expect(isProviderPreset("mimo")).toBe(true);
    expect(isProviderPreset("siliconflow")).toBe(true);
    expect(isProviderPreset("custom")).toBe(true);
    expect(isProviderPreset("unknown")).toBe(false);
    expect(getProviderPresetDefinition("deepseek").models[0].id).toBe("deepseek-v4-flash");
    expect(providerProtocol(getProviderPresetDefinition("anthropic"))).toBe("anthropic-messages");
  });

  it("carries CC-Switch-compatible model capability metadata", () => {
    expect(getProviderPresetDefinition("deepseek").models[0]).toMatchObject({
      contextWindow: 1_048_576,
      reasoningLevels: ["low", "high", "max"],
    });
    expect(getProviderPresetDefinition("deepseek").providerOptions).toMatchObject({
      openai: { thinking: true, reasoningEffort: true },
    });
    expect(getProviderPresetDefinition("minimax").models[0].id).toBe("MiniMax-M3");
    expect(getProviderPresetDefinition("modelscope").models[0].id).toBe("ZhipuAI/GLM-5.2");
  });

  it("exposes protocol capabilities without hiding custom connections", () => {
    expect(getProviderPresetDefinition("openai").providerOptions).toMatchObject({
      openai: { reasoningEffort: true },
    });
    const anthropic = getProviderPresetDefinition("anthropic");
    expect(providerCapabilities(anthropic)).toMatchObject({ json: "prompt", webSearch: false, tools: true });
    expect(providerCapabilities(getProviderPresetDefinition("zhipu")).toolChoice).toBe("auto");
    expect(providerProtocol(getProviderPresetDefinition("custom"))).toBe("openai-chat");
  });

  it("resolves PI-style metadata for concrete models", () => {
    const zhipu = getProviderModelProfile(getProviderPresetDefinition("zhipu"), "glm-5.3-flash");
    const deepSeek = getProviderModelProfile(getProviderPresetDefinition("deepseek"), "deepseek-v4-flash");
    const openAI = getProviderModelProfile(getProviderPresetDefinition("openai"), "gpt-5.6-sol");

    expect(zhipu).toMatchObject({
      reasoning: true,
      maxTokens: 32_768,
      compatibility: {
        thinkingFormat: "zai",
        maxTokensField: "max_tokens",
        supportsThinkingDisable: false,
        supportsToolCallStreaming: true,
      },
    });
    expect(getProviderModelProfile(getProviderPresetDefinition("zhipu"), "glm-5.3")).toMatchObject({
      compatibility: { supportsThinkingDisable: false },
    });
    expect(deepSeek).toMatchObject({
      reasoning: true,
      compatibility: { thinkingFormat: "deepseek" },
    });
    expect(openAI).toMatchObject({
      reasoning: true,
      compatibility: { thinkingFormat: "openai", maxTokensField: "max_completion_tokens" },
    });
  });
});
