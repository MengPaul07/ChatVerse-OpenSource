import { describe, expect, it } from "vitest";
import type { ToolCall } from "../../../contracts/provider.js";
import { createDirectorReferenceTable } from "./references.js";
import {
  executeDirectorTool,
  normalizeDirectorToolCall,
  type DirectorToolBindings,
} from "./tool-executor.js";
import type { WorldDirectorHost } from "./types.js";

function toolCall(argumentsValue: string): ToolCall {
  return {
    id: "call-1",
    type: "function",
    function: {
      name: "plan_beat",
      arguments: argumentsValue,
    },
  };
}

describe("normalizeDirectorToolCall", () => {
  it("keeps the first complete object when a provider appends content", () => {
    const result = normalizeDirectorToolCall(toolCall('{"chapterId":"chapter-1"}{"chapterId":"wrong"}'));
    expect(result.function.arguments).toBe('{"chapterId":"chapter-1"}');
  });

  it("removes a markdown fence around a complete object", () => {
    const result = normalizeDirectorToolCall(toolCall('```json\n{"contextId":"context-1"}\n```'));
    expect(result.function.arguments).toBe('{"contextId":"context-1"}');
  });

  it("keeps a retryable valid envelope for truncated arguments", () => {
    const result = normalizeDirectorToolCall(toolCall('{"chapterId":"chapter-1"'));
    expect(result.function.arguments).toBe("{}");
  });
});

describe("Director short-reference validation", () => {
  const references = createDirectorReferenceTable({
    actorIds: ["actor-1", "actor-2"],
    contextIds: ["context-1"],
    chapterIds: ["chapter-1"],
    beatIds: [],
    eventIds: ["event-1"],
  });

  const host: WorldDirectorHost = {
    now: () => 0,
    nextId: () => "beat-created",
    inspectContext: () => "",
    queryNarrative: () => "",
    inspectActor: () => "",
    searchActors: () => "",
    retrieveSource: () => ({ chunkIds: [], content: "" }),
    validateSourceBundleId: () => false,
    validateSourceChunkIds: () => false,
    sourceBindingRevision: () => undefined,
    canControlActor: () => true,
    validateContextId: (id) => id === "context-1",
    validateActorId: (id) => id === "actor-1" || id === "actor-2",
    validateActorBackgroundUpdate: () => undefined,
    validateSpawnActor: () => undefined,
    validateSpawnedActor: () => undefined,
    validateEventId: (id) => id === "event-1",
    validateBeatId: () => false,
    validateChapterId: (id) => id === "chapter-1",
    validateBeatSources: () => undefined,
  };

  function script(actorRef: string) {
    return {
      time: "当前",
      location: "当前 Context",
      cast: [{ actorRef, roleInScene: "推动当前局面" }],
      cause: "当前压力已经显现。",
      development: ["压力显现。", "角色行动。", "局面产生新结果。"],
      turningPoint: "新结果改变选择空间。",
      result: "一个可观察的阶段结果已经成立。",
      causalChain: ["压力迫使行动。", "行动产生结果。", "结果改变后续选择。"],
    };
  }

  function execute(
    args: Record<string, unknown>,
    bindings: DirectorToolBindings = {
      chapterId: "chapter-1",
      sourceEventIds: ["event-1"],
    },
  ) {
    const mutations = [] as Parameters<typeof executeDirectorTool>[1];
    const result = executeDirectorTool(
      {
        id: "plan-call",
        type: "function",
        function: { name: "plan_beat", arguments: JSON.stringify(args) },
      },
      mutations,
      host,
      references,
      new Set(),
      new Set(),
      false,
      false,
      bindings,
    );
    return { result, mutations };
  }

  function validArgs(overrides: Record<string, unknown> = {}) {
    return {
      title: "一幕",
      brief: "这一幕让当前局面发生具体变化。",
      script: script("A1"),
      completesChapter: false,
      minimumActorTurns: 3,
      maximumActorTurns: 6,
      contextRefs: ["C1"],
      actorRefs: ["A1"],
      ...overrides,
    };
  }

  it("resolves valid typed refs and ignores forged Host-owned fields", () => {
    const { result, mutations } = execute(validArgs({
      chapterId: "attacker-chapter",
      sourceEventIds: ["attacker-event"],
    }));

    expect(result.accepted).toBe(true);
    expect(mutations[0]).toMatchObject({
      type: "plan_beat",
      chapterId: "chapter-1",
      contextIds: ["context-1"],
      actorIds: ["actor-1"],
      sourceEventIds: ["event-1"],
    });
  });

  it.each([
    ["unknown alias", "A99"],
    ["wrong case", "a1"],
    ["actor name", "Alice"],
    ["runtime UUID", "world:actor:actor-1"],
    ["cross-type alias", "C1"],
  ])("rejects %s without staging a partial Beat", (_label, actorRef) => {
    const { result, mutations } = execute(validArgs({
      actorRefs: [actorRef],
      script: script(actorRef),
    }));

    expect(result.accepted).toBe(false);
    expect(mutations).toEqual([]);
  });

  it("requires the cast refs to exactly match actorRefs", () => {
    const { result, mutations } = execute(validArgs({
      actorRefs: ["A1", "A2"],
      script: script("A1"),
    }));

    expect(result.accepted).toBe(false);
    expect(result.output).toContain("exactly match actorRefs");
    expect(mutations).toEqual([]);
  });
});
