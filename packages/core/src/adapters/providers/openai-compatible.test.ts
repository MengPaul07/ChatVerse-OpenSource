import { beforeEach, describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import {
  createOpenAIChatProvider,
  normalizeTokenUsage,
} from "./openai-compatible.js";
import { createOpenAIResponsesResearchProvider } from "./openai-research.js";

const openAiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  responsesCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    readonly chat = {
      completions: {
        create: openAiMocks.create,
      },
    };
    readonly responses = {
      create: openAiMocks.responsesCreate,
    };
  },
}));

beforeEach(() => {
  openAiMocks.create.mockReset();
  openAiMocks.responsesCreate.mockReset();
});

describe("normalizeTokenUsage", () => {
  it("preserves DeepSeek cache and reasoning token details", () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
      completion_tokens_details: {
        accepted_prediction_tokens: 0,
        audio_tokens: 0,
        reasoning_tokens: 7,
        rejected_prediction_tokens: 0,
      },
    } as OpenAI.Completions.CompletionUsage & {
      prompt_cache_hit_tokens: number;
      prompt_cache_miss_tokens: number;
    };

    expect(normalizeTokenUsage(usage, "deepseek-reasoner", "deepseek")).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cacheHitInputTokens: 80,
      cacheMissInputTokens: 20,
      reasoningTokens: 7,
      provider: "deepseek",
      model: "deepseek-reasoner",
      protocol: "openai-chat",
    });
  });
});

describe("OpenAI Chat options", () => {
  it("downgrades required Director tool choice for endpoints that only support auto", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "glm-5.3-flash",
      choices: [{ message: { content: null, tool_calls: [] } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "glm-5.3-flash",
      providerName: "智谱 AI",
      providerOptions: { openai: { toolChoice: "auto" } },
    });

    await provider.chat({
      messages: [{ role: "user", content: "规划下一幕" }],
      tools: [{
        type: "function",
        function: {
          name: "plan_beat",
          description: "Plan a beat.",
          parameters: { type: "object" },
        },
      }],
      toolChoice: "required",
    });

    expect(openAiMocks.create.mock.calls[0]?.[0]).toMatchObject({ tool_choice: "auto" });
    expect(provider.profile?.capabilities.toolChoice).toBe("auto");
  });

  it("passes non-thinking task mode through to the DeepSeek request", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "test-model",
      choices: [{
        message: {
          content: null,
          reasoning_content: "inspect the current beat",
          tool_calls: [{
            id: "task-call",
            type: "function",
            function: { name: "plan_beat", arguments: "{}" },
          }],
        },
      }],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
      },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "test-model",
      providerName: "deepseek",
      providerOptions: { openai: { thinking: true, toolChoice: "required" } },
    });

    const response = await provider.chat({
      messages: [{ role: "user", content: "执行任务" }],
      tools: [{
        type: "function",
        function: {
          name: "plan_beat",
          description: "Plan a beat.",
          parameters: { type: "object" },
        },
      }],
      toolChoice: "required",
      thinking: "disabled",
    });

    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: "required",
        thinking: { type: "disabled" },
      }),
      expect.any(Object),
    );
    expect(response.toolCalls[0]?.function.name).toBe("plan_beat");
    expect(response.reasoningContent).toBe("inspect the current beat");
  });

  it("omits forced tool choice while DeepSeek thinking mode is enabled", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "test-model",
      choices: [{ message: { content: null, tool_calls: [] } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "test-model",
      providerName: "deepseek",
      providerOptions: { openai: { thinking: true, omitToolChoiceWhenThinking: true } },
    });

    await provider.chat({
      messages: [{ role: "user", content: "执行任务" }],
      tools: [{
        type: "function",
        function: {
          name: "plan_beat",
          description: "Plan a beat.",
          parameters: { type: "object" },
        },
      }],
      toolChoice: "required",
      thinking: "enabled",
    });

    const request = openAiMocks.create.mock.calls[0]?.[0];
    expect(request).toEqual(expect.objectContaining({
      thinking: { type: "enabled" },
    }));
    expect(request).not.toHaveProperty("tool_choice");
  });

  it("streams visible Markdown while assembling split tool calls and usage", async () => {
    openAiMocks.create.mockResolvedValue(streamChunks([
      {
        model: "test-model",
        choices: [{ delta: { content: "## 创作" } }],
      },
      {
        model: "test-model",
        choices: [{
          delta: {
            content: "计划\n",
            reasoning_content: "hidden",
            tool_calls: [{
              index: 0,
              id: "call-1",
              function: {
                name: "apply_draft_",
                arguments: "{\"baseRevision\":",
              },
            }],
          },
        }],
      },
      {
        model: "test-model",
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                name: "operations",
                arguments: "0,\"operations\":[]}",
              },
            }],
          },
        }],
      },
      {
        model: "test-model",
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      },
    ]));
    const deltas: string[] = [];
    const usage: unknown[] = [];
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "test-model",
      providerName: "deepseek",
      providerOptions: { openai: { thinking: true } },
    });

    const response = await provider.chat({
      messages: [{ role: "user", content: "创建世界" }],
      onTextDelta: (delta) => deltas.push(delta),
      onUsage: (value) => usage.push(value),
    });

    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        stream_options: { include_usage: true },
      }),
      expect.any(Object),
    );
    expect(deltas).toEqual(["## 创作", "计划\n"]);
    expect(response.content).toBe("## 创作计划\n");
    expect(response.reasoningContent).toBe("hidden");
    expect(response.toolCalls).toEqual([{
      id: "call-1",
      type: "function",
      function: {
        name: "apply_draft_operations",
        arguments: "{\"baseRevision\":0,\"operations\":[]}",
      },
    }]);
    expect(response.usage?.totalTokens).toBe(20);
    expect(usage).toHaveLength(1);
  });

  it("replays reasoning only for assistant tool-call turns", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "test-model",
      choices: [{ finish_reason: "stop", message: { content: "done", tool_calls: [] } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "test-model",
      providerName: "deepseek",
      providerOptions: { openai: { thinking: true } },
    });

    await provider.chat({
      messages: [
        { role: "assistant", content: "plain", reasoningContent: "drop me" },
        {
          role: "assistant",
          content: "",
          reasoningContent: "replay me",
          tool_calls: [{
            id: "inspect-1",
            type: "function",
            function: { name: "inspect_draft", arguments: "{}" },
          }],
        },
        { role: "tool", tool_call_id: "inspect-1", content: "{\"ok\":true}" },
      ],
      thinking: "enabled",
      reasoningEffort: "max",
    });

    const request = openAiMocks.create.mock.calls[0]?.[0];
    expect(request).toEqual(expect.objectContaining({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    }));
    expect(request.messages[0]).not.toHaveProperty("reasoning_content");
    expect(request.messages[1]).toEqual(expect.objectContaining({
      reasoning_content: "replay me",
      tool_calls: [expect.objectContaining({ id: "inspect-1" })],
    }));
  });

  it("maps a provider length finish to max_tokens", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "test-model",
      choices: [{ finish_reason: "length", message: { content: "partial", tool_calls: [] } }],
      usage: { prompt_tokens: 2, completion_tokens: 8, total_tokens: 10 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "test-model",
      providerName: "deepseek",
    });

    await expect(provider.chat({
      messages: [{ role: "user", content: "write" }],
    })).resolves.toEqual(expect.objectContaining({
      content: "partial",
      finishReason: "max_tokens",
    }));
  });

  it("aborts a stalled request at the adapter timeout", async () => {
    openAiMocks.create.mockImplementation((_request, options) => (
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      })
    ));
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "test-model",
      providerName: "deepseek",
      providerOptions: { openai: { thinking: true } },
      timeoutMs: 10,
    });

    await expect(provider.chat({
      messages: [{ role: "user", content: "ping" }],
    })).rejects.toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
  });
});

describe("DeepSeek configuration", () => {
  it("passes non-thinking JSON mode through to the DeepSeek request", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "test-model",
      choices: [{ message: { content: '{"actorUpdates":[]}' } }],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
      },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "test-model",
      providerName: "deepseek",
      providerOptions: { openai: { thinking: true } },
    });

    await provider.complete({
      systemPrompt: "memory",
      userPrompt: "整理记忆",
      responseFormat: { type: "json_object" },
      thinking: "disabled",
    });

    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      }),
      expect.any(Object),
    );
  });
});

describe("createOpenAIChatProvider", () => {
  it("uses the concrete GLM profile with native thinking and simplified JSON Schema", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "glm-5.3-flash",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{
            id: "glm-call",
            type: "function",
            function: { name: "plan_beat", arguments: "{}" },
          }],
        },
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "glm-5.3-flash",
      providerName: "智谱 AI",
      modelProfile: {
        id: "glm-5.3-flash",
        name: "stale browser profile",
        reasoning: true,
        input: ["text"],
        compatibility: {
          thinkingFormat: "zai",
          supportsReasoningEffort: true,
          supportsThinkingDisable: false,
        },
      },
    });

    await provider.chat({
      messages: [{ role: "user", content: "规划下一幕" }],
      tools: [{
        type: "function",
        function: {
          name: "plan_beat",
          description: "Plan a beat.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              chapterId: { type: "string", const: "chapter-1" },
            },
            allOf: [{ required: ["chapterId"] }],
          },
        },
      }],
      toolChoice: "required",
      thinking: "enabled",
      reasoningEffort: "high",
      maxTokens: 2_000,
    });

    const request = openAiMocks.create.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      model: "glm-5.3-flash",
      max_tokens: 32_768,
      tool_choice: "auto",
      tools: [{
        function: {
          parameters: {
            type: "object",
            properties: { chapterId: { type: "string" } },
          },
        },
      }],
    });
    expect(request).toHaveProperty("thinking", { type: "enabled" });
    expect(request).not.toHaveProperty("reasoning_effort");
    expect(request.tools[0].function).not.toHaveProperty("strict");
  });

  it("streams GLM tool calls and enables provider-side argument streaming", async () => {
    openAiMocks.create.mockResolvedValue((async function* () {
      yield {
        model: "glm-5.3-flash",
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "glm-stream-call",
              function: { name: "plan_beat", arguments: "{\"chapterId\":\"chapter-1\"}" },
            }],
          },
          finish_reason: "tool_calls",
        }],
      };
    })());
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "glm-5.3-flash",
      providerName: "智谱 AI",
    });

    const response = await provider.chat({
      messages: [{ role: "user", content: "规划下一幕" }],
      tools: [{
        type: "function",
        function: {
          name: "plan_beat",
          description: "Plan a beat.",
          parameters: { type: "object" },
        },
      }],
      toolChoice: "required",
      thinking: "enabled",
      stream: true,
    });

    expect(openAiMocks.create.mock.calls[0]?.[0]).toMatchObject({
      stream: true,
      tool_stream: true,
      thinking: { type: "enabled" },
      tool_choice: "auto",
    });
    expect(response.toolCalls).toEqual([{
      id: "glm-stream-call",
      type: "function",
      function: { name: "plan_beat", arguments: "{\"chapterId\":\"chapter-1\"}" },
    }]);
  });

  it("keeps thinking enabled without unsupported effort when GLM 5.3 rejects the disabled mode", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "glm-5.3-flash",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "glm-5.3-flash",
      providerName: "智谱 AI",
    });

    await provider.complete({
      systemPrompt: "system",
      userPrompt: "修复规划",
      thinking: "disabled",
      reasoningEffort: "off",
    });

    expect(openAiMocks.create.mock.calls[0]?.[0]).toMatchObject({
      thinking: { type: "enabled" },
    });
    expect(openAiMocks.create.mock.calls[0]?.[0]).not.toHaveProperty("reasoning_effort");
  });

  it("uses the selected model without sending DeepSeek-only extensions", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "qwen-plus",
      choices: [{ message: { content: "ok" } }],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 1,
        total_tokens: 3,
      },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "qwen-plus",
    });

    await provider.complete({
      systemPrompt: "system",
      userPrompt: "hello",
      thinking: "disabled",
    });

    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "qwen-plus" }),
      expect.any(Object),
    );
    expect(openAiMocks.create.mock.calls[0]?.[0]).not.toHaveProperty("thinking");
    expect(openAiMocks.create.mock.calls[0]?.[0]).not.toHaveProperty("reasoning_effort");
  });

  it("sends standard reasoning effort only when the protocol profile opts in", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "gpt-5.2",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "gpt-5.2",
      providerOptions: { openai: { reasoningEffort: true } },
    });

    await provider.chat({
      messages: [{ role: "user", content: "检查" }],
      reasoningEffort: "high",
    });

    expect(openAiMocks.create.mock.calls[0]?.[0]).toMatchObject({
      reasoning_effort: "high",
    });
    expect(provider.profile?.capabilities.reasoning).toBe("option");
  });

  it("maps an explicit reasoning-off request to the model's native off value", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "gpt-5.2",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "gpt-5.2",
    });

    await provider.chat({
      messages: [{ role: "user", content: "不要推理" }],
      thinking: "disabled",
    });

    expect(openAiMocks.create.mock.calls[0]?.[0]).toMatchObject({
      reasoning_effort: "none",
    });
  });

  it("uses the DeepSeek thinking disable field for the concrete reasoner", async () => {
    openAiMocks.create.mockResolvedValue({
      model: "deepseek-v4-flash",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    const provider = createOpenAIChatProvider({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
    });

    await provider.chat({
      messages: [{ role: "user", content: "不要推理" }],
      thinking: "disabled",
    });

    expect(openAiMocks.create.mock.calls[0]?.[0]).toMatchObject({
      thinking: { type: "disabled" },
    });
  });
});

describe("createOpenAIResponsesResearchProvider", () => {
  it("uses the stateless Responses web_search contract and normalizes citations", async () => {
    openAiMocks.responsesCreate.mockResolvedValue({
      model: "deepseek-v4-flash",
      status: "completed",
      output_text: "赤壁之战发生在东汉末年。",
      output: [
        {
          type: "web_search_call",
          action: {
            sources: [{ title: "史料来源", url: "https://example.com/history" }],
          },
        },
        {
          type: "message",
          content: [{
            type: "output_text",
            annotations: [{
              type: "url_citation",
              title: "同一来源",
              url: "https://example.com/history",
            }],
          }],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 80 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    });
    const usage: unknown[] = [];
    const provider = createOpenAIResponsesResearchProvider({
      apiKey: "test-key",
      baseURL: "https://api.example.test/v1",
      model: "deepseek-v4-flash",
      providerName: "deepseek",
    });

    const result = await provider.search({
      query: "赤壁之战发生年代",
      purpose: "校准历史背景",
      onUsage: (value) => usage.push(value),
    });

    expect(result.summary).toContain("赤壁之战");
    expect(result.sources).toEqual([expect.objectContaining({
      title: "史料来源",
      url: "https://example.com/history",
    })]);
    expect(usage).toEqual([expect.objectContaining({
      inputTokens: 100,
      outputTokens: 20,
      cacheHitInputTokens: 80,
      reasoningTokens: 2,
    })]);
    expect(openAiMocks.responsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-flash",
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: "赤壁之战发生年代",
      }),
      expect.any(Object),
    );
    const request = openAiMocks.responsesCreate.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty("store");
    expect(request).not.toHaveProperty("previous_response_id");
    expect(request).not.toHaveProperty("include");
    expect(request.max_output_tokens).toBe(32_768);
  });

  it("keeps usable partial results when Responses reaches the output-token limit", async () => {
    openAiMocks.responsesCreate.mockResolvedValue({
      model: "deepseek-v4-flash",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "部分历史摘要",
      output: [{
        type: "web_search_call",
        action: {
          sources: [{ title: "史料来源", url: "https://example.com/partial" }],
        },
      }],
      usage: {
        input_tokens: 100,
        output_tokens: 4096,
        total_tokens: 4196,
      },
    });
    const provider = createOpenAIResponsesResearchProvider({
      apiKey: "test-key",
      baseURL: "https://api.example.test/v1",
      model: "deepseek-v4-flash",
      providerName: "deepseek",
    });

    await expect(provider.search({
      query: "部分历史摘要",
      purpose: "校准历史背景",
    })).resolves.toEqual({
      summary: "部分历史摘要",
      sources: [expect.objectContaining({
        title: "史料来源",
        url: "https://example.com/partial",
      })],
    });
  });

  it("normalizes an incomplete Responses result when no research result is usable", async () => {
    openAiMocks.responsesCreate.mockResolvedValue({
      model: "deepseek-v4-flash",
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output_text: "",
      output: [],
    });
    const provider = createOpenAIResponsesResearchProvider({
      apiKey: "test-key",
      baseURL: "https://api.example.test/v1",
      model: "deepseek-v4-flash",
      providerName: "deepseek",
    });

    await expect(provider.search({
      query: "受限内容",
      purpose: "测试失败分支",
    })).rejects.toMatchObject({
      code: "provider_request_failed",
      retryable: false,
      protocol: "responses-web-search",
    });
  });
});

async function* streamChunks(
  chunks: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const chunk of chunks) yield chunk;
}
