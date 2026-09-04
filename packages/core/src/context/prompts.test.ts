import { describe, expect, it } from "vitest";
import type { CharacterCard, ChatMessage } from "../contracts/chat.js";
import type { ActorMemorySlice } from "../contracts/actor-memory.js";
import { ContextBuilder } from "./builder.js";
import {
  CHARACTER_SYSTEM_PROMPT,
  WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT,
  WORLD_ACTOR_SYSTEM_PROMPT,
  buildWorldActorDecisionHint,
  buildHarnessIdleTriggerCtx,
  buildWorldActorIdleTriggerCtx,
  HARNESS_DECISION_JSON_SYSTEM_PROMPT,
} from "./prompts.js";

const alice: CharacterCard = {
  name: "Alice",
  description: "负责记录数据的研究员。",
  personality: "冷静，偶尔会用简短玩笑缓和气氛。",
  scenario: "正在群里协调今天的观测安排。",
  messageExample: "先把数据发我，我来对一下。",
  instructions: "自定义设定：Alice 不使用感叹号。只讨论仍未解决的观测问题。",
};

const bob: CharacterCard = {
  name: "Bob",
  description: "负责现场巡查。",
  personality: "话少直接。",
  scenario: "刚从观测站回来。",
  messageExample: "我过去看一眼。",
};

function createBuilder(): ContextBuilder {
  return new ContextBuilder({
    scene: { groupName: "测试协调群", topic: "第三区观测", atmosphere: "平静" },
    characters: [alice, bob],
    humans: [{ name: "玩家", card: "群里的真人参与者" }],
    relations: [{ from: "Alice", to: "Bob", description: "信任对方的现场判断。" }],
    getCharacterStates: () => [],
  });
}

const history: ChatMessage[] = [
  {
    id: "message-1",
    characterName: "Bob",
    message: "西段数据刚回传，暂时稳定。",
    source: "character",
    timestamp: 1,
  },
];

describe("prompt contracts", () => {
  it("keeps character chat output separate from harness JSON state patches", () => {
    expect(CHARACTER_SYSTEM_PROMPT).toContain("不要输出 [STATE: ...]");
    expect(CHARACTER_SYSTEM_PROMPT).not.toContain("[STATE: mood=");
    expect(HARNESS_DECISION_JSON_SYSTEM_PROMPT).toContain("statePatch");
    expect(HARNESS_DECISION_JSON_SYSTEM_PROMPT).toContain("必须只输出一个合法 JSON object");
  });

  it("requires a natural first Harness speaker while keeping later idle checks optional", () => {
    expect(buildHarnessIdleTriggerCtx(true)).toContain('必须返回包含至少一个 message 的 type="perform"');
    expect(buildHarnessIdleTriggerCtx(false)).toContain("不是每次都必须发言");
  });

  it("uses a separate World actor contract with complete single-wake performances", () => {
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("持续运转的世界");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("本轮任务");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("第一条 message 直接回应");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("每次被唤醒都要通过 perform");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("不得换词重说");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("一次 wake 内完成自然连续的表达");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("优先在自然停顿处分成 2-3 条连续 message");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("每项承担不同作用");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("简短回答、单一判断或一句自然台词保持一条");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).toContain("每次 wake 只能使用 perform");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).toContain("倾向输出多个 message items 一次完成");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).toContain("guidance 是 Narrator 针对当前 Beat 给出的直接执行指令");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).toContain("不要把责任退回 Narrator");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).toContain("伴随性动作默认全部省略");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("每 4-6 条角色消息一次有意义动作");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).toContain("不要凑数");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).toContain("最近约 5 条角色输出都没有动作");
    expect(buildWorldActorDecisionHint("", "")).not.toContain("最近约 5 条角色输出都没有动作");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).not.toContain("兼容");
    expect(buildWorldActorIdleTriggerCtx(true)).not.toContain("兼容");
    expect(WORLD_ACTOR_SYSTEM_PROMPT).not.toContain("silent");
    expect(WORLD_ACTOR_DECISION_JSON_SYSTEM_PROMPT).not.toContain("silent");
    expect(buildWorldActorIdleTriggerCtx(false)).not.toContain("silent");
    expect(buildWorldActorIdleTriggerCtx(false)).toContain("角色的自主活动时刻");
    expect(buildWorldActorIdleTriggerCtx(false)).toContain("用 perform 交付");
    expect(buildWorldActorDecisionHint("", "", {
      maxBurstCount: 3,
      allowStickers: false,
      preferShortMessages: false,
    })).toContain("一段表达承担多个语义作用时，优先拆成自然的连续消息");
  });

  it("keeps custom character guidance in the Actor-specific user prefix", () => {
    const prompt = createBuilder().buildHarnessCharacter("Alice", history);

    expect(prompt.systemPrompt).toContain("你是一个真实群聊中的成员");
    expect(prompt.systemPrompt).toContain("发送前自检");
    expect(prompt.userPrompt).toContain("自定义设定：Alice 不使用感叹号。");
  });

  it("places Harness identity and instructions before the dynamic history", () => {
    const prompt = createBuilder().buildHarnessCharacter("Alice", history);
    const historyIndex = prompt.userPrompt.indexOf("【聊天记录】");

    expect(prompt.userPrompt.indexOf("【你的角色：Alice】")).toBeLessThan(historyIndex);
    expect(prompt.userPrompt.indexOf("【群里的其他人】")).toBeLessThan(historyIndex);
    expect(prompt.userPrompt.indexOf("只讨论仍未解决的观测问题。")).toBeLessThan(historyIndex);
    expect(prompt.userPrompt).not.toContain("【群成员】");
    expect(prompt.userPrompt).toContain("对话状态：flowing");
  });

  it("assembles World actor context without changing the Group prompt", () => {
    const sharedLore = {
      name: "测试世界书",
      description: "Director 才能看到的全局设定。",
      entries: [{
        keys: ["西塔"],
        content: "西塔地下藏着无人知晓的密室。",
        priority: 1,
        position: "before" as const,
        constant: true,
      }],
    };
    const worldBuilder = new ContextBuilder({
      ...createBuilder().input,
      actorPromptMode: "world",
      worldBook: sharedLore,
      getCharacterStates: () => [{
        characterName: "Bob",
        availability: "available",
        attention: "active",
        intent: "暗中调查 Alice",
        updatedAt: 1,
        source: "character",
      }],
      getActorMemory: (name) => name === "Alice"
        ? {
            actorId: "alice",
            estimatedTokens: 16,
            entries: [{
              score: 5,
              node: {
                id: "memory:signal",
                kind: "episode",
                title: "旧信号",
                content: "Alice 记得上次异常也发生在西段。",
              },
            }],
          }
        : undefined,
      getCurrentWorldScene: () => ({
        id: "user-narration",
        contextId: "context-main",
        text: "众人已经离开山口，转入河谷。",
        sourceEventIds: [],
        occurredAt: 1,
      }),
    });
    const groupBuilder = new ContextBuilder({
      ...createBuilder().input,
      worldBook: sharedLore,
    });
    const worldPrompt = worldBuilder.buildHarnessCharacter("Alice", history);
    const otherWorldPrompt = worldBuilder.buildHarnessCharacter("Bob", history);
    const groupPrompt = groupBuilder.buildHarnessCharacter("Alice", history);

    expect(worldPrompt.systemPrompt).toContain("持续运转的世界");
    expect(worldPrompt.systemPrompt).not.toContain("你是一个真实群聊中的成员");
    expect(worldPrompt.systemPrompt).not.toContain("自定义设定：Alice 不使用感叹号。");
    expect(worldPrompt.systemPrompt).toBe(otherWorldPrompt.systemPrompt);
    expect(worldPrompt.userPrompt).toContain("角色专属行为约束");
    expect(worldPrompt.userPrompt).toContain("自定义设定：Alice 不使用感叹号。");
    expect(worldPrompt.userPrompt).toContain("【互动上下文：测试协调群】");
    expect(worldPrompt.userPrompt).toContain("AI 角色：Alice、Bob");
    expect(worldPrompt.userPrompt).toContain("【当前剧情节点：测试协调群】");
    expect(worldPrompt.userPrompt).toContain("众人已经离开山口，转入河谷。");
    expect(worldPrompt.userPrompt).toContain("你在这个世界中的背景与既有认知");
    const aliceIdentityIndex = worldPrompt.userPrompt.indexOf("【你的角色身份：Alice】");
    const bobIdentityIndex = otherWorldPrompt.userPrompt.indexOf("【你的角色身份：Bob】");
    expect(worldPrompt.userPrompt.slice(0, aliceIdentityIndex))
      .toBe(otherWorldPrompt.userPrompt.slice(0, bobIdentityIndex));
    expect(worldPrompt.userPrompt.indexOf("【你在这个世界中的背景与既有认知】"))
      .toBeGreaterThan(aliceIdentityIndex);
    expect(worldPrompt.userPrompt.indexOf("【你的相关长期记忆】"))
      .toBeGreaterThan(worldPrompt.userPrompt.indexOf("【你在这个世界中的背景与既有认知】"));
    expect(worldPrompt.userPrompt.indexOf("【当前剧情节点：测试协调群】"))
      .toBeGreaterThan(worldPrompt.userPrompt.indexOf("【你的相关长期记忆】"));
    // 增量时间线改造后,world Actor 的历史由最前的共享时间线块承载,
    // 不再维护滑动窗口式的【最近互动记录】。
    expect(worldPrompt.userPrompt).not.toContain("【最近互动记录】");
    expect(worldPrompt.userPrompt).not.toContain("负责现场巡查");
    expect(worldPrompt.userPrompt).not.toContain("测试世界书");
    expect(worldPrompt.userPrompt).not.toContain("无人知晓的密室");
    expect(worldPrompt.userPrompt).not.toContain("暗中调查 Alice");
    expect(worldPrompt.systemPrompt).toContain("当前剧情节点描述的是此刻可观察的局面");
    expect(worldPrompt.systemPrompt).toContain("职业、职责、能力与背景只说明你会什么");
    expect(worldPrompt.systemPrompt).toContain("其他角色说过的话只是对方的主张");
    expect(worldPrompt.systemPrompt).toContain("不得自行生成精确数字");
    expect(groupPrompt.systemPrompt).toContain("你是一个真实群聊中的成员");
    expect(groupPrompt.userPrompt).toContain("【群聊：测试协调群】");
    expect(groupPrompt.userPrompt).toContain("【聊天记录】");
    expect(groupPrompt.userPrompt).toContain("无人知晓的密室");
  });

  it("progressively discloses only the World Actor's private lore", () => {
    const privateLore = {
      entries: [
        {
          keys: [],
          content: "你一直知道自己来自北境。",
          priority: 1,
          position: "before" as const,
          constant: true,
        },
        {
          keys: ["西段"],
          content: "你曾在西段见过相同的异常。",
          priority: 2,
          position: "before" as const,
          constant: false,
        },
        {
          keys: ["王都"],
          content: "王都档案馆保存着旧地图。",
          priority: 3,
          position: "before" as const,
          constant: false,
        },
      ],
    };
    const builder = new ContextBuilder({
      ...createBuilder().input,
      actorPromptMode: "world",
      characters: [{ ...alice, loreBook: privateLore }, bob],
    });

    const prompt = builder.buildHarnessCharacter("Alice", history).userPrompt;

    expect(prompt).toContain("你一直知道自己来自北境");
    expect(prompt).toContain("你曾在西段见过相同的异常");
    expect(prompt).not.toContain("王都档案馆");
  });

  it("uses the latest Director-managed Actor background without mutating the card", () => {
    const builder = new ContextBuilder({
      ...createBuilder().input,
      actorPromptMode: "world",
      getActorWorldBackground: (name) => (
        name === "Alice"
          ? "Alice 已离开观测站，正在护送样本前往北塔。"
          : undefined
      ),
    });

    const prompt = builder.buildHarnessCharacter("Alice", history).userPrompt;

    expect(prompt).toContain("Alice 已离开观测站，正在护送样本前往北塔");
    expect(prompt).not.toContain("正在群里协调今天的观测安排");
    expect(alice.scenario).toBe("正在群里协调今天的观测安排。");
  });

  it("injects only the resolver-selected actor memory before history", () => {
    const slice: ActorMemorySlice = {
      actorId: "alice",
      estimatedTokens: 24,
      entries: [{
        score: 8,
        node: {
          id: "tower",
          kind: "episode",
          title: "西塔记录",
          content: "Bob 曾在西段隐瞒过一次异常。",
          sourceEventIds: ["world-event-1"],
        },
      }],
    };
    const builder = new ContextBuilder({
      scene: { groupName: "测试协调群", topic: "第三区观测", atmosphere: "平静" },
      characters: [alice, bob],
      humans: [],
      relations: [],
      getCharacterStates: () => [],
      getActorMemory: (name) => name === "Alice" ? slice : undefined,
    });

    const alicePrompt = builder.buildHarnessCharacter("Alice", history);
    const bobPrompt = builder.buildHarnessCharacter("Bob", history);
    expect(alicePrompt.userPrompt).toContain("【你的相关长期记忆】");
    expect(alicePrompt.userPrompt).toContain("西塔记录");
    expect(alicePrompt.userPrompt.indexOf("【你的相关长期记忆】"))
      .toBeLessThan(alicePrompt.userPrompt.indexOf("【聊天记录】"));
    expect(bobPrompt.userPrompt).not.toContain("西塔记录");
  });

  it("keeps the Actor-specific prefix before the incremental timeline", () => {
    const builder = new ContextBuilder({
      ...createBuilder().input,
      actorPromptMode: "world",
      getWorldTimeline: () => "【较早事件摘要】\n前情提要。\n\n【新增事件】\n【旁白】：山风掠过。",
    });
    const prompt = builder.buildHarnessCharacter("Alice", history);
    expect(prompt.userPrompt.startsWith("【互动上下文：测试协调群】")).toBe(true);
    expect(prompt.userPrompt.indexOf("【时间线】"))
      .toBeGreaterThan(prompt.userPrompt.indexOf("【互动上下文：测试协调群】"));
    expect(prompt.userPrompt.indexOf("【时间线】"))
      .toBeGreaterThan(prompt.userPrompt.indexOf("【你的角色身份：Alice】"));
    expect(prompt.userPrompt).not.toContain("【最近互动记录】");
  });
});
