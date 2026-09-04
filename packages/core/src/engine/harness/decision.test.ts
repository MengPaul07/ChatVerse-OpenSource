import { describe, expect, it } from "vitest";
import { parseAgentDecisionJson } from "./decision.js";

describe("AgentDecision", () => {
  it("normalizes a Harness burst and state patch", () => {
    const decision = parseAgentDecisionJson(JSON.stringify({
      type: "perform",
      items: [
        { kind: "message", message: "等等" },
        { kind: "message", message: "我刚看了一下，不太对" },
        { kind: "message", message: "我刚看了一下，不太对" },
      ],
      hesitationSec: 1,
      statePatch: { presence: "away", status: "正在核对数据" },
    }));

    expect(decision).toMatchObject({
      type: "perform",
      items: [
        { kind: "message", message: "等等" },
        { kind: "message", message: "我刚看了一下，不太对" },
      ],
      hesitationSec: 1,
      statePatch: { availability: "away", note: "正在核对数据" },
    });
  });

  it("preserves the order of messages and observable actions", () => {
    expect(parseAgentDecisionJson(JSON.stringify({
      type: "perform",
      items: [
        { kind: "action", action: "慢慢靠近石缝，侧耳听了听" },
        { kind: "message", message: "有人来了。" },
        { kind: "action", action: "压低声音，往后退了半步" },
        { kind: "message", message: "先别惊动他。" },
        { kind: "action", action: "这一项超过动作上限" },
      ],
    }))).toEqual({
      type: "perform",
      items: [
        { kind: "action", action: "慢慢靠近石缝，侧耳听了听" },
        { kind: "message", message: "有人来了。" },
        { kind: "action", action: "压低声音，往后退了半步" },
        { kind: "message", message: "先别惊动他。" },
      ],
      hesitationSec: undefined,
      idleCooldownSec: undefined,
      statePatch: undefined,
      reason: undefined,
    });
  });

  it("keeps a self-leave transition only on the final action", () => {
    expect(parseAgentDecisionJson(JSON.stringify({
      type: "perform",
      items: [
        { kind: "action", action: "走到门边", contextTransition: "leave" },
        { kind: "message", message: "我先走了。" },
        { kind: "action", action: "推门离开", contextTransition: "leave" },
      ],
    }))).toMatchObject({
      type: "perform",
      items: [
        { kind: "action", action: "走到门边" },
        { kind: "message", message: "我先走了。" },
        { kind: "action", action: "推门离开", contextTransition: "leave" },
      ],
    });
  });

  it("rejects an empty performance and bounds timing hints", () => {
    expect(() => parseAgentDecisionJson(JSON.stringify({
      type: "perform",
      items: [],
    }))).toThrow("at least one valid item");

    expect(parseAgentDecisionJson(JSON.stringify({
      type: "silent",
      idleCooldownSec: -10,
    }))).toMatchObject({ idleCooldownSec: 0 });
  });

});
