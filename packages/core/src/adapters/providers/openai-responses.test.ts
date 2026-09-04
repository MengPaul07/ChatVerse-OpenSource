import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAIResponsesProvider,
} from "./openai-responses.js";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    readonly responses = { create: mocks.create };
  },
}));

beforeEach(() => mocks.create.mockReset());

describe("OpenAI Responses provider", () => {
  it("maps stateless messages and function calls to the Responses protocol", async () => {
    mocks.create.mockResolvedValue({
      status: "completed",
      output_text: "已读取。",
      output: [{
        type: "function_call",
        call_id: "call-1",
        name: "inspect_draft",
        arguments: '{"sections":["core"]}',
      }],
      usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 },
    });
    const provider = createOpenAIResponsesProvider({
      apiKey: "test-key",
      model: "responses-model",
      providerName: "OpenAI",
    });

    const result = await provider.chat({
      messages: [
        { role: "system", content: "保持简洁" },
        { role: "user", content: "检查草稿" },
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
      maxTokens: 120,
    });

    expect(result).toMatchObject({
      content: "已读取。",
      toolCalls: [{
        id: "call-1",
        function: { name: "inspect_draft", arguments: '{"sections":["core"]}' },
      }],
      finishReason: "tool_calls",
      usage: { protocol: "openai-responses", totalTokens: 16 },
    });
    expect(provider.profile).toMatchObject({
      protocol: "openai-responses",
      providerName: "OpenAI",
      capabilities: { tools: true, webSearch: true },
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      instructions: "保持简洁",
      input: [{ role: "user", content: "检查草稿" }],
      tool_choice: "required",
      max_output_tokens: 32_768,
    }), expect.any(Object));
  });

  it("assembles streamed text, reasoning, and split function arguments", async () => {
    mocks.create.mockResolvedValue(streamEvents([
      { type: "response.output_item.added", item: { type: "function_call", call_id: "call-2", name: "save", arguments: "" } },
      { type: "response.output_text.delta", delta: "正在" },
      { type: "response.reasoning_summary_text.delta", delta: "先检查" },
      { type: "response.function_call_arguments.delta", item_id: "call-2", delta: '{"ok":' },
      { type: "response.function_call_arguments.delta", item_id: "call-2", delta: "true}" },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 } } },
    ]));
    const deltas: string[] = [];
    const usages: unknown[] = [];
    const provider = createOpenAIResponsesProvider({ apiKey: "test-key", model: "responses-model" });

    const result = await provider.chat({
      messages: [{ role: "user", content: "执行" }],
      onTextDelta: (delta) => deltas.push(delta),
      onUsage: (usage) => usages.push(usage),
    });

    expect(deltas).toEqual(["正在"]);
    expect(result.content).toBe("正在");
    expect(result.reasoningContent).toBe("先检查");
    expect(result.toolCalls).toEqual([{
      id: "call-2",
      type: "function",
      function: { name: "save", arguments: '{"ok":true}' },
    }]);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ protocol: "openai-responses", totalTokens: 12 });
  });
});

async function* streamEvents(events: Array<Record<string, unknown>>): AsyncGenerator<Record<string, unknown>> {
  for (const event of events) yield event;
}
