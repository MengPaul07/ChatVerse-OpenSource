import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropicMessagesProvider } from "./anthropic-messages.js";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    readonly messages = { create: mocks.create };
  },
}));

beforeEach(() => mocks.create.mockReset());

describe("Anthropic Messages provider", () => {
  it("maps system prompts and tool results to Anthropic content blocks", async () => {
    mocks.create.mockResolvedValue({
      type: "message",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "先查看资料" },
        { type: "text", text: "我先检查。" },
        { type: "tool_use", id: "tool-1", name: "inspect_draft", input: { sections: ["core"] } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 14, output_tokens: 9 },
    });
    const provider = createAnthropicMessagesProvider({
      apiKey: "test-key",
      model: "claude-test",
      providerName: "Anthropic",
      providerOptions: { anthropic: { extendedThinking: true, thinkingBudgetTokens: 2048 } },
    });

    const result = await provider.chat({
      messages: [
        { role: "system", content: "你是创作助手" },
        { role: "user", content: "检查" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "previous", type: "function", function: { name: "read", arguments: "{\"id\":1}" } }],
        },
        { role: "tool", tool_call_id: "previous", content: "{\"ok\":true}" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "inspect_draft",
          description: "Inspect the draft.",
          parameters: { type: "object" },
        },
      }],
      toolChoice: "required",
      thinking: "enabled",
    });

    expect(result).toMatchObject({
      content: "我先检查。",
      reasoningContent: "先查看资料",
      toolCalls: [{
        id: "tool-1",
        function: { name: "inspect_draft", arguments: '{"sections":["core"]}' },
      }],
      finishReason: "tool_calls",
      usage: { protocol: "anthropic-messages", totalTokens: 23 },
    });
    expect(provider.profile).toMatchObject({
      protocol: "anthropic-messages",
      capabilities: { json: "prompt", reasoning: "option", webSearch: false },
    });
    const request = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.system).toBe("你是创作助手");
    expect(request.tool_choice).toEqual({ type: "any" });
    expect(request.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(request.messages).toEqual([
      { role: "user", content: "检查" },
      { role: "assistant", content: [{ type: "tool_use", id: "previous", name: "read", input: { id: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "previous", content: "{\"ok\":true}" }] },
    ]);
    expect(request).not.toHaveProperty("response_format");
  });

  it("omits tool_choice when tools are explicitly disabled", async () => {
    mocks.create.mockResolvedValue({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "完成" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = createAnthropicMessagesProvider({ apiKey: "test-key", model: "claude-test" });

    await provider.chat({
      messages: [{ role: "user", content: "直接回答" }],
      tools: [{
        type: "function",
        function: { name: "noop", description: "No-op.", parameters: { type: "object" } },
      }],
      toolChoice: "none",
    });

    const request = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request).not.toHaveProperty("tool_choice");
  });

  it("assembles streamed text, thinking, and tool input deltas", async () => {
    mocks.create.mockResolvedValue(streamEvents([
      { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-2", name: "save" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"name":' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"world\"}" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "完成" } },
      { type: "content_block_delta", index: 2, delta: { type: "thinking_delta", thinking: "已写入" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
    ]));
    const deltas: string[] = [];
    const usages: unknown[] = [];
    const provider = createAnthropicMessagesProvider({ apiKey: "test-key", model: "claude-test" });

    const result = await provider.chat({
      messages: [{ role: "user", content: "写入" }],
      onTextDelta: (delta) => deltas.push(delta),
      onUsage: (usage) => usages.push(usage),
    });

    expect(deltas).toEqual(["完成"]);
    expect(result).toMatchObject({
      content: "完成",
      reasoningContent: "已写入",
      toolCalls: [{
        id: "tool-2",
        function: { name: "save", arguments: '{"name":"world"}' },
      }],
      finishReason: "tool_calls",
    });
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ protocol: "anthropic-messages", totalTokens: 12 });
  });
});

async function* streamEvents(events: Array<Record<string, unknown>>): AsyncGenerator<Record<string, unknown>> {
  for (const event of events) yield event;
}
