import { describe, expect, it } from "vitest";
import type { ChatProvider, TokenUsage } from "../contracts/provider.js";
import {
  observeProviderUsage,
  type ProviderUsageObservation,
} from "./provider-usage.js";

const usage: TokenUsage = {
  inputTokens: 12,
  outputTokens: 3,
  totalTokens: 15,
  provider: "test",
  model: "fixed",
  protocol: "openai-chat",
};

describe("observeProviderUsage", () => {
  it("preserves caller callbacks and attributes complete requests", async () => {
    const observations: ProviderUsageObservation[] = [];
    const callerUsages: TokenUsage[] = [];
    const provider = observeProviderUsage(callbackProvider(), (event) => {
      observations.push(event);
    });

    await provider.complete({
      systemPrompt: "system",
      userPrompt: "user",
      requestContext: {
        purpose: "actor_decision",
        actorId: "actor-1",
      },
      onUsage: (value) => callerUsages.push(value),
    });

    expect(callerUsages).toEqual([usage]);
    expect(observations).toEqual([{
      operation: "complete",
      requestContext: {
        purpose: "actor_decision",
        actorId: "actor-1",
      },
      usage,
    }]);
  });

  it("uses ChatResponse usage as a fallback without double counting", async () => {
    const observations: ProviderUsageObservation[] = [];
    const provider = observeProviderUsage(responseOnlyProvider(), (event) => {
      observations.push(event);
    });

    await provider.chat({
      messages: [{ role: "user", content: "hello" }],
      requestContext: { purpose: "world_director" },
    });

    expect(observations).toEqual([{
      operation: "chat",
      requestContext: { purpose: "world_director" },
      usage,
    }]);
  });

  it("preserves the provider profile on the observation wrapper", () => {
    const profile = {
      protocol: "anthropic-messages" as const,
      providerName: "Anthropic",
      model: "claude-test",
      capabilities: {
        stream: true,
        tools: true,
        json: "prompt" as const,
        reasoning: "none" as const,
        webSearch: false,
        vision: false,
      },
      modelProfile: {
        id: "claude-test",
        reasoning: false,
        input: ["text" as const],
      },
      compatibility: {
        supportsReasoningEffort: false,
        supportsUsageInStreaming: true,
        supportsFinishReason: true,
        maxTokensField: "max_tokens",
        supportsStrictTools: false,
        supportsFullJsonSchema: true,
        toolChoiceFormat: "object",
      } as const,
    };
    const provider = observeProviderUsage({ ...callbackProvider(), profile }, () => undefined);

    expect(provider.profile).toEqual(profile);
  });
});

function callbackProvider(): ChatProvider {
  return {
    async complete(params) {
      params.onUsage?.(usage);
      return "ok";
    },
    async *stream() {
      yield "ok";
    },
    async chat(params) {
      params.onUsage?.(usage);
      return { content: "ok", toolCalls: [], usage };
    },
  };
}

function responseOnlyProvider(): ChatProvider {
  return {
    async complete() {
      return "ok";
    },
    async *stream() {
      yield "ok";
    },
    async chat() {
      return { content: "ok", toolCalls: [], usage };
    },
  };
}
