import { describe, expect, it } from "vitest";
import type { ChatProvider } from "@chatverse/core";
import {
  createPromptTraceState,
  createPromptTracingProvider,
} from "./prompt-trace.js";
import type { WorldRunPromptTrace } from "./types.js";

describe("prompt tracing", () => {
  it("finds the first changed prompt section without storing prompt text", async () => {
    const traces: WorldRunPromptTrace[] = [];
    const usage = {
      inputTokens: 20,
      outputTokens: 3,
      totalTokens: 23,
      cacheHitInputTokens: 12,
      cacheMissInputTokens: 8,
    };
    const provider: ChatProvider = {
      complete: async (params) => {
        params.onUsage?.(usage);
        return "{}";
      },
      stream: async function* () {
        yield "{}";
      },
      chat: async () => ({ content: null, toolCalls: [], usage }),
    };
    const traced = createPromptTracingProvider(
      provider,
      "director",
      traces,
      createPromptTraceState(),
    );

    await traced.complete({
      systemPrompt: "固定系统规范",
      userPrompt: "[World]\n稳定世界\n[Runtime state]\n第一次状态",
      requestContext: { purpose: "world_narrator" },
    });
    await traced.complete({
      systemPrompt: "固定系统规范",
      userPrompt: "[World]\n稳定世界\n[Runtime state]\n第二次状态",
      requestContext: { purpose: "world_narrator" },
    });

    expect(traces).toHaveLength(2);
    expect(traces[1]?.firstChangedSegment).toBe("[Runtime state]");
    expect(traces[1]?.stablePrefixChars).toBeGreaterThan(0);
    expect(traces[1]?.stablePrefixRate).toBeGreaterThan(0);
    expect(traces[1]?.segments.some((segment) => segment.sameAsPrevious)).toBe(true);
    expect(traces[1]?.usage).toEqual(usage);
    expect(JSON.stringify(traces)).not.toContain("第二次状态");
  });

  it("compares Actor prompts against the same Actor branch", async () => {
    const traces: WorldRunPromptTrace[] = [];
    const provider: ChatProvider = {
      complete: async () => "{}",
      stream: async function* () { yield "{}"; },
      chat: async () => ({ content: null, toolCalls: [] }),
    };
    const traced = createPromptTracingProvider(
      provider,
      "character",
      traces,
      createPromptTraceState(),
    );
    const request = (actorId: string, history: string) => traced.complete({
      systemPrompt: "固定角色规范",
      userPrompt: `[Identity]\n${actorId}\n[History]\n${history}`,
      requestContext: { purpose: "actor_decision", actorId },
    });

    await request("actor-a", "第一轮");
    await request("actor-b", "第一轮");
    await request("actor-a", "第二轮");

    expect(traces[2]?.comparedToPrevious).toBe(true);
    expect(traces[2]?.firstChangedSegment).toBe("[History]");
  });
});
