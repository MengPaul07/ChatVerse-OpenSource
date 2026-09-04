import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../../../contracts/provider.js";
import type { NarrativeBeat } from "../../../contracts/world.js";
import { PlayerTurnAgent, type PlayerTurnView } from "./player.js";

const beat: NarrativeBeat = {
  id: "beat-1",
  chapterId: "chapter-1",
  title: "山口异响",
  brief: "确认山口的异常来源。",
  script: {
    time: "黄昏",
    location: "山口",
    cast: [{ actorId: "player", roleInScene: "调查异常并决定是否继续前进" }],
    cause: "异常声响威胁通行。",
    development: ["异常逼近。", "玩家调查。", "来源显露。"],
    turningPoint: "异常来源改变当前选择。",
    result: "异常来源已被确认。",
    causalChain: ["声响迫使玩家停步。", "调查暴露来源。", "来源改变通行决定。"],
  },
  completesChapter: false,
  minimumActorTurns: 2,
  maximumActorTurns: 6,
  status: "running",
  actorIds: ["player"],
  contextIds: ["context-1"],
  sourceEventIds: [],
  occurredAt: 0,
};

function view(): PlayerTurnView {
  return {
    proposalId: "proposal-1",
    contextId: "context-1",
    actorId: "player",
    beat,
    sceneNow: "暮色中的山口。",
    recentEvents: "山道上传来碎石声。",
    cast: "player: 玩家 - 旅人",
    prompt: "你要如何处理眼前的碎石声？",
    guidance: "选择一种有实际区别的回应。",
    card: {
      name: "玩家",
      identity: "旅人",
      background: "正在穿过山口。",
      personality: "谨慎",
      appearance: "背着行囊。",
      speechStyle: "简洁直接。",
      boundaries: "不替其他角色作决定。",
    },
  };
}

function providerFor(outputs: string[]): ChatProvider {
  return {
    async complete() {
      return outputs.shift() ?? "{}";
    },
    async *stream() {
      // Not used.
    },
    async chat() {
      return { content: "", toolCalls: [] };
    },
  };
}

describe("PlayerTurnAgent", () => {
  it("accepts common option aliases without dropping the player turn", async () => {
    const agent = new PlayerTurnAgent(providerFor([JSON.stringify({
      options: [
        { label: "先观察", action: "我先观察碎石滚落的方向。" },
        { label: "直接询问", message: "我向山口喊话，询问是谁在那里。" },
      ],
      auto_performance: { label: "保持距离", performance: { action: "我退后半步，保持警惕。" } },
    })]));

    const proposal = await agent.propose(view());

    expect(proposal).toMatchObject({
      id: "proposal-1",
      contextId: "context-1",
      beatId: "beat-1",
      prompt: "你要如何处理眼前的碎石声？",
      guidance: "选择一种有实际区别的回应。",
    });
    expect(proposal.suggestions).toEqual([
      { label: "先观察", performance: { action: "我先观察碎石滚落的方向。" } },
      { label: "直接询问", performance: { message: "我向山口喊话，询问是谁在那里。" } },
    ]);
    expect(proposal.autoPerformance).toEqual({
      label: "保持距离",
      performance: { action: "我退后半步，保持警惕。" },
    });
  });

  it("repairs one malformed response before queuing the turn", async () => {
    const calls: Array<{ responseFormat?: unknown }> = [];
    const outputs = [
      "not json",
      JSON.stringify({
        suggestions: [
          { label: "观察", performance: { action: "我观察山口。" } },
          { label: "询问", performance: { message: "我向山口询问。" } },
        ],
        autoPerformance: { label: "观察", performance: { action: "我观察山口。" } },
      }),
    ];
    const provider: ChatProvider = {
      ...providerFor([]),
      async complete(input) {
        calls.push({ responseFormat: input.responseFormat });
        return outputs.shift() ?? "{}";
      },
    };

    const proposal = await new PlayerTurnAgent(provider).propose(view());

    expect(proposal.suggestions).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});
