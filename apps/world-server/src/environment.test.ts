import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  responses: vi.fn(),
  anthropic: vi.fn(),
  research: vi.fn(),
}));

vi.mock("@chatverse/core", () => ({
  createOpenAIChatProvider: mocks.chat,
  createOpenAIResponsesProvider: mocks.responses,
  createAnthropicMessagesProvider: mocks.anthropic,
  createWebResearchProvider: mocks.research,
  PROVIDER_PROTOCOLS: ["openai-chat", "openai-responses", "anthropic-messages"],
  isProviderProtocol: (value: unknown): value is string =>
    typeof value === "string"
      && ["openai-chat", "openai-responses", "anthropic-messages"].includes(value),
  isWebResearchProtocol: (value: unknown): value is string =>
    typeof value === "string"
      && ["responses-web-search", "tavily-search", "zhipu-web-search"].includes(value),
}));

import { createEnvironmentProviders } from "./environment.js";

const ENV_KEYS = [
  "CHATVERSE_PROVIDER_PROTOCOL",
  "CHATVERSE_PROVIDER_NAME",
  "CHATVERSE_API_KEY",
  "CHATVERSE_BASE_URL",
  "CHATVERSE_MODEL",
  "CHATVERSE_PROVIDER_OPTIONS_JSON",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "DIRECTOR_MODEL",
  "CHARACTER_MODEL",
  "AUTHORING_MODEL",
  "AUTHORING_RESEARCH_MODEL",
  "DEEPSEEK_RESEARCH_MODEL",
  "RESEARCH_MODEL",
  "CHATVERSE_RESEARCH_PROTOCOL",
  "CHATVERSE_RESEARCH_API_KEY",
  "CHATVERSE_RESEARCH_BASE_URL",
  "CHATVERSE_RESEARCH_PROVIDER_NAME",
  "CHATVERSE_RESEARCH_MODEL",
  "CHATVERSE_RESEARCH_OPTIONS_JSON",
];

const originalEnvironment = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  mocks.chat.mockReset().mockImplementation((config: Record<string, unknown>) => provider(config));
  mocks.responses.mockReset().mockImplementation((config: Record<string, unknown>) => provider(config));
  mocks.anthropic.mockReset().mockImplementation((config: Record<string, unknown>) => provider(config));
  mocks.research.mockReset().mockImplementation((config: Record<string, unknown>) => ({
    search: vi.fn(),
    config,
  }));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("environment provider selection", () => {
  it("keeps legacy DeepSeek credentials and endpoint in the same source family", async () => {
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    process.env.DEEPSEEK_API_KEY = "deep-key";
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";

    await createEnvironmentProviders();

    expect(mocks.chat).toHaveBeenCalledTimes(3);
    expect(mocks.chat).toHaveBeenNthCalledWith(1, expect.objectContaining({
      apiKey: "deep-key",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    }));
    expect(mocks.responses).not.toHaveBeenCalled();
    expect(mocks.anthropic).not.toHaveBeenCalled();
  });

  it("selects the Anthropic driver for an Anthropic protocol connection", async () => {
    await createEnvironmentProviders({
      protocol: "anthropic-messages",
      apiKey: "anthropic-key",
      baseURL: "https://api.anthropic.com",
      model: "claude-test",
      providerOptions: { anthropic: { extendedThinking: true } },
    });

    expect(mocks.anthropic).toHaveBeenCalledTimes(3);
    expect(mocks.anthropic).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "anthropic-key",
      model: "claude-test",
      providerOptions: { anthropic: { extendedThinking: true } },
    }));
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.responses).not.toHaveBeenCalled();
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it("uses the Responses driver for runtime and research when selected", async () => {
    await createEnvironmentProviders({
      protocol: "openai-responses",
      providerName: "Responses Gateway",
      apiKey: "responses-key",
      baseURL: "https://responses.example.test/v1",
      model: "responses-model",
      research: {
        protocol: "responses-web-search",
        apiKey: "research-key",
        baseURL: "https://research.example.test/v1",
        model: "research-model",
      },
    });

    expect(mocks.responses).toHaveBeenCalledTimes(3);
    expect(mocks.responses).toHaveBeenCalledWith(expect.objectContaining({
      providerName: "Responses Gateway",
      model: "responses-model",
    }));
    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      protocol: "responses-web-search",
      apiKey: "research-key",
      baseURL: "https://research.example.test/v1",
      model: "research-model",
    }));
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.anthropic).not.toHaveBeenCalled();
  });

  it("does not leak a Chat profile into the Responses research driver", async () => {
    const chatProfile = {
      id: "deepseek-v4-flash",
      reasoning: true,
      input: ["text"],
      compatibility: { thinkingFormat: "deepseek" },
    } as const;

    await createEnvironmentProviders({
      protocol: "openai-chat",
      apiKey: "test-key",
      baseURL: "https://gateway.example.test/v1",
      model: "deepseek-v4-flash",
      research: {
        protocol: "responses-web-search",
        apiKey: "research-key",
        baseURL: "https://gateway.example.test/v1",
        model: "deepseek-v4-flash",
      },
      modelProfile: chatProfile,
    });

    expect(mocks.research).toHaveBeenCalledWith(expect.objectContaining({
      model: "deepseek-v4-flash",
      protocol: "responses-web-search",
    }));
  });

  it("applies a model profile only to the matching concrete role model", async () => {
    const modelProfile = {
      id: "director-model",
      reasoning: true,
      input: ["text"],
      compatibility: { thinkingFormat: "openai" },
    } as const;

    await createEnvironmentProviders({
      protocol: "openai-chat",
      apiKey: "test-key",
      model: "shared-model",
      directorModel: "director-model",
      characterModel: "character-model",
      authoringModel: "authoring-model",
      modelProfile,
    });

    expect(mocks.chat).toHaveBeenNthCalledWith(1, expect.objectContaining({
      model: "director-model",
      modelProfile,
    }));
    expect(mocks.chat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: "character-model",
      modelProfile: undefined,
    }));
    expect(mocks.chat).toHaveBeenNthCalledWith(3, expect.objectContaining({
      model: "authoring-model",
      modelProfile: undefined,
    }));
  });
});

function provider(config: Record<string, unknown>): Record<string, unknown> {
  return {
    profile: config,
    complete: vi.fn(),
    stream: vi.fn(),
    chat: vi.fn(),
  };
}
