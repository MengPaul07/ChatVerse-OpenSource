import { describe, expect, it } from "vitest";
import {
  createFallbackModelProfile,
  getBuiltInModelProfile,
  resolveModelProfile,
} from "./model-profile.js";

describe("PI-style model profiles", () => {
  it("keeps concrete model compatibility separate from the protocol", () => {
    const glm = getBuiltInModelProfile("openai-chat", "glm-5.3-flash");
    const deepSeek = getBuiltInModelProfile("openai-chat", "deepseek-v4-flash");
    const openAI = getBuiltInModelProfile("openai-chat", "gpt-5.2");

    expect(glm).toMatchObject({
      reasoning: true,
      maxTokens: 32_768,
      compatibility: {
        thinkingFormat: "zai",
        supportsThinkingDisable: false,
        supportsFullJsonSchema: false,
        maxTokensField: "max_tokens",
        supportsToolCallStreaming: true,
      },
    });
    expect(getBuiltInModelProfile("openai-chat", "glm-5.3")).toMatchObject({
      compatibility: { supportsThinkingDisable: false },
    });
    expect(deepSeek).toMatchObject({
      reasoning: true,
      compatibility: { thinkingFormat: "deepseek" },
    });
    expect(openAI).toMatchObject({
      reasoning: true,
      compatibility: {
        thinkingFormat: "openai",
        supportsReasoningEffort: true,
        maxTokensField: "max_completion_tokens",
        supportsFullJsonSchema: true,
      },
    });
  });

  it("uses a conservative profile for an unlisted model", () => {
    const profile = createFallbackModelProfile("openai-chat", "gateway-model");

    expect(profile).toMatchObject({
      id: "gateway-model",
      reasoning: false,
      input: ["text"],
      compatibility: {
        supportsTools: true,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    });
    expect(profile.compatibility?.thinkingFormat).toBeUndefined();
  });

  it("does not apply a stale profile to a different concrete model", () => {
    const stale = getBuiltInModelProfile("openai-chat", "deepseek-v4-flash")!;
    const resolved = resolveModelProfile("openai-chat", "glm-5.3-flash", stale);

    expect(resolved.id).toBe("glm-5.3-flash");
    expect(resolved.reasoning).toBe(true);
    expect(resolved.compatibility?.thinkingFormat).toBe("zai");
  });
});
