import { describe, expect, it } from "vitest";
import {
  getImageProviderPresetDefinition,
  IMAGE_PROVIDER_PRESETS,
  isImageProviderPreset,
} from "./imageProviderCatalog";

describe("image provider catalog", () => {
  it("contains unique provider presets with complete generation defaults", () => {
    const ids = IMAGE_PROVIDER_PRESETS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of IMAGE_PROVIDER_PRESETS.filter((item) => item.category !== "custom")) {
      expect(definition.baseURL).toMatch(/^https:\/\//);
      expect(definition.models.length).toBeGreaterThan(0);
      expect(definition.landscapeSizes[0]).toMatch(/^\d+x\d+$/);
      expect(definition.portraitSizes[0]).toMatch(/^\d+x\d+$/);
    }
  });

  it("covers every native adapter and keeps a custom OpenAI escape hatch", () => {
    expect(new Set(IMAGE_PROVIDER_PRESETS.map((item) => item.protocol))).toEqual(new Set([
      "openai", "gemini", "stability", "bfl", "dashscope", "ark", "siliconflow", "openrouter",
    ]));
    expect(isImageProviderPreset("custom-openai")).toBe(true);
    expect(getImageProviderPresetDefinition("packyapi")).toMatchObject({
      baseURL: "https://cf.api.fan/v1",
      protocol: "openai",
      models: [{ id: "gpt-image-2" }],
    });
    expect(isImageProviderPreset("unknown")).toBe(false);
    expect(getImageProviderPresetDefinition("gemini").models[0]?.id).toBe("gemini-3.1-flash-image");
    expect(getImageProviderPresetDefinition("openrouter")).toMatchObject({
      baseURL: "https://openrouter.ai/api/v1",
      protocol: "openrouter",
    });
  });
});
