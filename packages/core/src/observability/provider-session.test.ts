import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../contracts/provider.js";
import { observeProviderSession, type ProviderSessionEvent } from "./provider-session.js";

describe("observeProviderSession", () => {
  it("records full chat requests and responses as one correlated exchange", async () => {
    const events: ProviderSessionEvent[] = [];
    const provider = observeProviderSession(fixedProvider(), (event) => events.push(event), clock());

    await provider.chat({
      messages: [{ role: "user", content: "完整输入" }],
      tools: [{
        type: "function",
        function: { name: "inspect", description: "inspect", parameters: { type: "object" } },
      }],
      requestContext: { purpose: "world_director", turnId: "turn-1" },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "request",
      operation: "chat",
      input: { messages: [{ role: "user", content: "完整输入" }] },
    });
    expect(events[1]).toMatchObject({
      type: "response",
      operation: "chat",
      output: {
        content: "完整输出",
        reasoningContent: "隐藏推理",
        toolCalls: [{ function: { name: "inspect", arguments: "{}" } }],
      },
    });
    expect(events[1]?.requestId).toBe(events[0]?.requestId);
  });

  it("collects every stream delta into the completed output", async () => {
    const events: ProviderSessionEvent[] = [];
    const provider = observeProviderSession(fixedProvider(), (event) => events.push(event), clock());
    let visible = "";
    for await (const delta of provider.stream({ systemPrompt: "s", userPrompt: "u" })) visible += delta;
    expect(visible).toBe("完整流");
    expect(events[1]).toMatchObject({ type: "response", output: "完整流" });
  });
});

function fixedProvider(): ChatProvider {
  return {
    async complete() { return "完整输出"; },
    async *stream() { yield "完整"; yield "流"; },
    async chat() {
      return {
        content: "完整输出",
        reasoningContent: "隐藏推理",
        toolCalls: [{ id: "call-1", type: "function", function: { name: "inspect", arguments: "{}" } }],
      };
    },
  };
}

function clock(): () => number {
  let value = 100;
  return () => value++;
}
