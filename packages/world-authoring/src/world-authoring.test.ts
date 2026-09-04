import { describe, expect, it } from "vitest";
import type { CharacterCard, ChatProvider, GroupCard, WebResearchProvider } from "@chatverse/core";
import {
  applyWorldDraftOperations,
  compileGroupCardFromWorldDraft,
  compileWorldDraft,
  createEmptyWorldDraft,
  validateWorldDraft,
  WorldArchitect,
  WORLD_CREATION_SKILL,
  worldDraftFromGroupCard,
} from "./index.js";

const ACTOR: CharacterCard = {
  name: "行者",
  description: "被困在山下的旧日英雄",
  personality: "机敏、骄傲，说话直接",
  scenario: "已被困多年，只知道山脚附近发生的事情",
  messageExample: "少绕弯子，且说你来做什么。",
};

const PLAYER_CARD = {
  name: "旅人",
  identity: "误入山中的旅人",
  background: "从山外来到此处，正在寻找离开的路。",
  personality: "谨慎但愿意追问",
  appearance: "穿着沾尘的旅行衣",
  speechStyle: "说话直接，先确认再行动",
  boundaries: "不知道山中秘闻，没有超出普通人的能力。",
};

describe("WorldDraft", () => {
  it("applies typed operations and compiles a story world", () => {
    let sequence = 0;
    const draft = createEmptyWorldDraft({ id: "world:test", name: "试验世界" });
    const actorId = "world:test:actor:hero";
    const contextId = draft.contexts[0]!.id;
    const next = applyWorldDraftOperations(draft, [
      {
        type: "set_metadata",
        metadata: { description: "一段等待被改变的旅程" },
      },
      { type: "set_premise", premise: "旅人来到一座被封印的山前。" },
      { type: "set_lore", lore: { core: "旧神留下封印，凡人并不知道真相。" } },
      {
        type: "set_sources",
        sources: [{ bundleId: "source:classic", revision: 2, fidelity: "reference" }],
      },
      {
        type: "upsert_actor",
        actor: { id: actorId, role: "lead", card: ACTOR },
      },
      {
        type: "upsert_player",
        player: {
          id: "world:test:player",
          mode: "participant",
          profile: { name: "你", card: "误入山中的旅人" },
          playerCard: PLAYER_CARD,
        },
      },
      {
        type: "upsert_context",
        context: {
          id: contextId,
          name: "山脚",
          actorIds: [actorId, "world:test:player"],
          scene: {
            groupName: "试验世界",
            topic: "封印松动",
            atmosphere: "暮色压在山脊上",
            state: "flowing",
          },
          opening: "暮色中，山腹传来锁链轻响。",
        },
      },
      {
        type: "upsert_chapter",
        chapter: {
          title: "封印为何松动",
          treatment: "旅人来到被封印的山前，必须在山中旧势力、正在松动的封印和自身未知来历之间逐步查清风险。章节通过多场调查、试探与选择展开，允许角色在现场证据与彼此不信任之间形成不同的推进路径。",
          targetOutcome: "旅人与山中守门者确认封印松动的直接原因，并决定是否共同进入山腹处理它。",
          actorIds: [actorId],
          contextIds: [contextId],
        },
      },
      {
        type: "upsert_chapter",
        chapter: {
          title: "进入山腹",
          treatment: "旅人与守门者在确认封印异常后，沿着山腹旧路逐步处理新的风险、资源和彼此的责任边界。后续剧情应通过多场探索、协商和现场反馈改变他们的行动条件，而不是用一次对话直接结束整段旅程。",
          targetOutcome: "旅人与守门者完成进入山腹前的共同准备，并确立可执行的继续行动约束。",
          status: "queued",
          actorIds: [actorId],
          contextIds: [contextId],
        },
      },
    ], {
      expectedRevision: 0,
      idGenerator: (prefix) => `generated:${prefix}:${++sequence}`,
    });

    expect(validateWorldDraft(next).valid).toBe(true);
    const world = compileWorldDraft(next, { now: 123 });
    expect(world.contexts[0]?.runtime?.actorRuntime?.activation).toBe("beat_runtime");
    expect(world.actorMemoryPolicy?.enabled).toBe(true);
    expect(world.contexts[0]?.presentation).toEqual(expect.objectContaining({
      kind: "galgame",
      playerActorId: next.player?.id,
    }));
    const playerActor = world.actors.find((actor) => actor.playerControlled === true);
    expect(playerActor?.kind).toBe("character");
    expect(playerActor?.playerCard).toEqual(PLAYER_CARD);
    expect(world.chapters?.[0]).toEqual(expect.objectContaining({
      title: "封印为何松动",
      targetOutcome: "旅人与山中守门者确认封印松动的直接原因，并决定是否共同进入山腹处理它。",
    }));
    expect(world.sources).toEqual([
      { bundleId: "source:classic", revision: 2, fidelity: "reference" },
    ]);
    expect(world.actors.find((actor) => (
      actor.card.name === "行者"
    ))?.id).not.toBe(actorId);
  });

  it("rejects a story draft without an opening chapter", () => {
    const draft = createEmptyWorldDraft({ id: "world:no-chapter", name: "无主线世界" });
    const validation = validateWorldDraft(draft);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "missing_chapter",
      severity: "error",
    }));
    expect(() => compileWorldDraft(draft)).toThrow("WorldDraft 无法编译");
  });

  it("requires a queued chapter for a story draft", () => {
    const draft = createEmptyWorldDraft({ id: "world:no-queued" });
    draft.chapters = [{
      id: "world:no-queued:chapter:active",
      title: "封印异响",
      treatment: "旅人在山脚发现封印异常，需要通过多场观察、询问和试探确认风险，并在同行者、旧势力和未知来历之间逐步建立可执行的判断。",
      targetOutcome: "旅人与同行者确认封印异响的直接原因，并形成下一阶段的行动约束。",
      status: "active",
      actorIds: [],
      contextIds: [draft.contexts[0]!.id],
    }];

    expect(validateWorldDraft(draft).issues).toContainEqual(expect.objectContaining({
      code: "missing_queued_chapters",
      severity: "error",
    }));
  });

  it("requires a complete player card for a story world", () => {
    const draft = createEmptyWorldDraft({ id: "world:player-card" });
    const validation = validateWorldDraft(draft);

    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "missing_world_player",
      severity: "error",
    }));
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "missing_player_card_name",
      severity: "error",
    }));
  });

  it("requires the story context to include the player and an AI actor", () => {
    const draft = createEmptyWorldDraft({ id: "world:context-participants" });
    const next = applyWorldDraftOperations(draft, [
      {
        type: "upsert_player",
        player: {
          id: "player:main",
          profile: { name: "管理员", card: "穿越者" },
          playerCard: PLAYER_CARD,
        },
      },
      {
        type: "upsert_actor",
        actor: { id: "actor:main", role: "lead", card: ACTOR },
      },
      {
        type: "upsert_context",
        context: {
          id: draft.contexts[0]!.id,
          name: "主场景",
          actorIds: [],
          scene: {
            groupName: "主场景",
            topic: "相遇",
            atmosphere: "安静",
            state: "flowing",
            rules: [],
          },
          opening: "门在夜色里打开。",
        },
      },
    ]);
    const validation = validateWorldDraft(next);

    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "missing_player_context_actor",
      severity: "error",
    }));
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "missing_context_actor",
      severity: "error",
    }));
  });

  it("preserves the player card and presentation across partial Studio updates", () => {
    const draft = createEmptyWorldDraft({ id: "world:partial-update" });
    const playerId = "player:main";
    const contextId = draft.contexts[0]!.id;
    const withCards = applyWorldDraftOperations(draft, [
      {
        type: "upsert_player",
        player: {
          id: playerId,
          profile: { name: "管理员", card: "穿越者" },
          playerCard: PLAYER_CARD,
        },
      },
      {
        type: "upsert_actor",
        actor: { id: "actor:main", role: "lead", card: ACTOR },
      },
      {
        type: "upsert_context",
        context: {
          id: contextId,
          name: "主场景",
          actorIds: [playerId, "actor:main"],
          scene: {
            groupName: "主场景",
            topic: "相遇",
            atmosphere: "安静",
            state: "flowing",
            rules: [],
          },
          opening: "门在夜色里打开。",
          presentation: {
            kind: "galgame",
            playerActorId: playerId,
            artDirection: "克制的舞台插画",
            backgroundGeneration: "auto",
            acknowledgement: "required",
          },
        },
      },
    ]);
    const actualPlayerId = withCards.player!.id;
    const updated = applyWorldDraftOperations(withCards, [
      {
        type: "upsert_player",
        player: { id: actualPlayerId, profile: { name: "管理员", card: "已更新公开身份" } },
      },
      {
        type: "upsert_context",
        context: {
          id: contextId,
          name: "主场景",
          scene: withCards.contexts[0]!.scene,
          opening: withCards.contexts[0]!.opening,
        },
      },
    ]);

    expect(updated.player?.playerCard).toEqual(PLAYER_CARD);
    expect(updated.contexts[0]?.presentation).toEqual(expect.objectContaining({
      kind: "galgame",
      playerActorId: actualPlayerId,
    }));
  });

  it("refuses to remove referenced actors", () => {
    const draft = createEmptyWorldDraft({ id: "world:test" });
    const withActor = applyWorldDraftOperations(draft, [{
      type: "upsert_actor",
      actor: { id: "actor:a", card: ACTOR },
    }]);
    const generatedActorId = withActor.actors[0]!.id;
    const withContext = applyWorldDraftOperations(withActor, [{
      type: "upsert_context",
      context: {
        ...withActor.contexts[0]!,
        actorIds: [generatedActorId],
      },
    }]);
    expect(() => applyWorldDraftOperations(withContext, [{
      type: "remove_actor",
      actorId: generatedActorId,
    }])).toThrow(/Context/);
  });

  it("converts a group into a draft and back without name-based runtime references", () => {
    const group: GroupCard = {
      kind: "chatverse.group",
      schemaVersion: 1,
      metadata: { id: "group:test", name: "旧群" },
      characters: [ACTOR],
      userProfiles: [{ name: "玩家", card: "群成员" }],
      scene: {
        groupName: "旧群",
        topic: "近况",
        atmosphere: "安静",
        state: "flowing",
      },
      relations: {
        relations: [{ from: "行者", to: "玩家", description: "刚认识" }],
      },
    };
    const draft = worldDraftFromGroupCard(group);
    const compiled = compileGroupCardFromWorldDraft(draft);
    const world = compileWorldDraft(draft);
    expect(world.contexts[0]?.conversationMode).toBe("group");
    expect(draft.relations[0]?.fromActorId).toContain(":actor:");
    expect(compiled.relations).toEqual({
      relations: [{ from: "行者", to: "玩家", description: "刚认识" }],
    });
    expect(compiled.worldRef).toEqual({
      worldId: draft.id,
      contextId: draft.contexts[0]?.id,
    });
  });

  it("allows a natural text response without a forced authoring loop", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() {
        return "";
      },
      async *stream() {
        // Not used.
      },
      async chat() {
        calls += 1;
        return {
          content: "我建议先补充世界简介。",
          toolCalls: [],
        };
      },
    };
    const architect = new WorldArchitect(provider);
    const result = await architect.run({
      draft: createEmptyWorldDraft({ id: "world:retry" }),
      instruction: "补充世界简介",
    });

    expect(calls).toBe(1);
    expect(result.changeSet).toBeUndefined();
    expect(result.summary).toBe("我建议先补充世界简介。");
    expect(result.workingDraft.metadata.description).toBe("");
  });

  it("keeps the built-in world creation spec in the stable system prompt", async () => {
    const provider: ChatProvider = {
      async complete() {
        return "";
      },
      async *stream() {
        // Not used.
      },
      async chat({ messages, tools, reasoningEffort, maxTokens }) {
        expect(tools?.some((tool) => tool.function.name === "inspect_draft")).toBe(true);
        expect(reasoningEffort).toBe("max");
        expect(maxTokens).toBeUndefined();
        expect(messages[0]?.role).toBe("system");
        expect(messages[0]?.content).toContain("不要把整个世界一次生成完");
        expect(messages[0]?.content).toContain("不能复制全量世界书");
        expect(messages[0]?.content).toContain("使用原生工具调用");
        return actionResponse("finish", "finish", { summary: "已读取创作流程。" });
      },
    };

    const result = await new WorldArchitect(provider).run({
      draft: createEmptyWorldDraft({ id: "world:skill" }),
      instruction: "读取你的创作流程",
    });

    expect(WORLD_CREATION_SKILL.sections.actors.instructions)
      .toContain("不能复制全量世界书");
    expect(result.summary).toBe("已读取创作流程。");
  });

  it("executes native tool calls and returns each result as a tool observation", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages, tools }) {
        calls++;
        expect(tools?.some((tool) => tool.function.name === "inspect_draft")).toBe(true);
        if (calls === 1) {
          return {
            content: "我先确认当前草稿。",
            toolCalls: [toolCall("inspect", "inspect_draft", { sections: ["metadata"] })],
          };
        }
        expect(messages.at(-1)).toEqual(expect.objectContaining({
          role: "tool",
          tool_call_id: "inspect",
        }));
        return {
          content: "草稿已经检查完成。",
          toolCalls: [toolCall("finish", "finish", { summary: "检查完成。" })],
        };
      },
    };

    const result = await new WorldArchitect(provider).run({
      draft: createEmptyWorldDraft({ id: "world:json-envelope" }),
      instruction: "检查草稿，不要修改。",
    });

    expect(calls).toBe(2);
    expect(result.summary).toBe("检查完成。");
    expect(result.execution.toolCalls).toBe(2);
  });

  it("returns a precise operation error instead of leaking a JavaScript null dereference", async () => {
    let calls = 0;
    let observedError = "";
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages }) {
        calls++;
        if (calls === 1) {
          return actionResponse("broken", "test_draft_operations", {
            baseRevision: 0,
            batch: {
              objective: "添加角色",
              operations: [{ type: "upsert_actor" }],
            },
          });
        }
        observedError = [...messages].reverse().find((message) => message.role === "tool")?.content ?? "";
        return actionResponse("finish", "finish", { summary: "已停止。", questions: ["请补充角色设定。"] });
      },
    };

    await new WorldArchitect(provider).run({
      draft: createEmptyWorldDraft({ id: "world:invalid-operation" }),
      instruction: "添加角色",
    });

    expect(observedError).toContain("actor 必须是对象");
    expect(observedError).not.toContain("Cannot read properties");
  });

  it("rejects incomplete model-authored cards at the operation boundary", () => {
    const draft = createEmptyWorldDraft({ id: "world:invalid-card" });
    expect(() => applyWorldDraftOperations(draft, [{
      type: "upsert_actor",
      actor: {
        id: "actor:partial",
        card: { name: "只有名字" },
      },
    } as never])).toThrow(/actor\.card\.description/);
  });

  it("exposes web research only when enabled and carries compact sources into the change set", async () => {
    let calls = 0;
    let researchCalls = 0;
    const provider: ChatProvider = {
      async complete() {
        return "";
      },
      async *stream() {
        // Not used.
      },
      async chat({ messages, tools }) {
        calls++;
        if (calls === 1) {
          expect(tools?.some((tool) => tool.function.name === "research_web")).toBe(true);
          expect(messages.at(-1)?.content).toContain("research_web 已启用");
          return {
            content: "",
            toolCalls: [{
              id: "plan",
              type: "function",
              function: {
                name: "write_authoring_plan",
                arguments: JSON.stringify({
                  goal: "补充一个有来源的历史背景",
                  items: [
                    { title: "补齐世界背景", scope: "foundation" },
                    { title: "检查角色关系", scope: "actors" },
                  ],
                }),
              },
            }],
          };
        }
        if (calls === 2) {
          return {
            content: "",
            toolCalls: [{
              id: "research",
              type: "function",
              function: {
                name: "research_web",
                arguments: JSON.stringify({
                  query: "赤壁之战发生年代",
                  purpose: "校准历史题材世界的时间背景",
                }),
              },
            }],
          };
        }
        if (calls === 3) {
          return {
            content: "",
            toolCalls: [{
              id: "apply",
              type: "function",
              function: {
                name: "update_world_core",
                arguments: JSON.stringify({
                  lore: { core: "背景参考已加入，具体史实仍需创作者自行确认。" },
                }),
              },
            }],
          };
        }
        return {
          content: "",
          toolCalls: [{
            id: "finish",
            type: "function",
            function: {
              name: "finish",
              arguments: JSON.stringify({ summary: "已补充历史背景参考。" }),
            },
          }],
        };
      },
    };
    const researchProvider: WebResearchProvider = {
      async search() {
        researchCalls++;
        return {
          summary: "公开资料显示，赤壁之战通常被置于东汉建安十三年前后。",
          sources: [{
            title: "历史资料",
            url: "https://example.com/chibi",
            accessedAt: 1,
            note: "校准时代背景",
          }],
        };
      },
    };

    const result = await new WorldArchitect(provider, {
      researchEnabled: true,
      researchProvider,
    }).run({
      draft: createEmptyWorldDraft({ id: "world:research" }),
      instruction: "补充赤壁之战的历史背景",
    });

    expect(researchCalls).toBe(1);
    expect(result.changeSet?.researchSources).toEqual([expect.objectContaining({
      url: "https://example.com/chibi",
      title: "历史资料",
    })]);
    expect(result.workingDraft.researchSources).toEqual([expect.objectContaining({
      url: "https://example.com/chibi",
    })]);
  });

  it("executes multiple web searches returned in the same native tool-call step", async () => {
    let modelCalls = 0;
    let researchCalls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages, tools, toolChoice, thinking, reasoningEffort }) {
        modelCalls++;
        expect(toolChoice).toBeUndefined();
        expect(thinking).toBe("enabled");
        expect(reasoningEffort).toBe("max");
        if (modelCalls === 1) {
          expect(tools?.some((tool) => tool.function.name === "research_web")).toBe(true);
          return {
            content: "",
            toolCalls: [
              toolCall("research-1", "research_web", { query: "资料一", purpose: "核对时间" }),
              toolCall("research-2", "research_web", { query: "资料二", purpose: "核对人物" }),
              toolCall("research-3", "research_web", { query: "资料三", purpose: "核对地点" }),
            ],
          };
        }
        expect(tools?.some((tool) => tool.function.name === "research_web")).toBe(true);
        const observations = messages.filter((message) => message.role === "tool");
        expect(observations).toHaveLength(3);
        expect(observations.every((message) => JSON.parse(message.content).ok === true)).toBe(true);
        return actionResponse("finish", "finish", { summary: "三项资料已核对。" });
      },
    };
    const researchProvider: WebResearchProvider = {
      async search({ query }) {
        researchCalls++;
        return {
          summary: `${query}的检索摘要`,
          sources: [{
            title: query,
            url: `https://example.com/${researchCalls}`,
            accessedAt: researchCalls,
            note: "用于测试同一步多次检索",
          }],
        };
      },
    };

    const result = await new WorldArchitect(provider, {
      researchEnabled: true,
      researchProvider,
    }).run({
      draft: createEmptyWorldDraft({ id: "world:parallel-research" }),
      instruction: "分别检索三项资料后总结。",
    });

    expect(researchCalls).toBe(3);
    expect(result.workingDraft.researchSources).toHaveLength(3);
    expect(result.summary).toBe("三项资料已核对。");
  });

  it("keeps the tool set and reasoning mode stable after research observations", async () => {
    let modelCalls = 0;
    let researchCalls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages, tools, toolChoice, thinking, reasoningEffort }) {
        modelCalls++;
        if (modelCalls === 1) {
          return {
            content: "",
            toolCalls: Array.from({ length: 3 }, (_, index) => toolCall(
              `research-${index}`,
              "research_web",
              { query: `资料${index}`, purpose: "建立世界" },
            )),
          };
        }
        if (modelCalls === 2) {
          expect(tools?.some((tool) => tool.function.name === "research_web")).toBe(true);
          expect(tools?.some((tool) => tool.function.name === "update_world_core")).toBe(true);
          expect(tools?.some((tool) => tool.function.name === "apply_draft_operations")).toBe(false);
          expect(toolChoice).toBeUndefined();
          expect(thinking).toBe("enabled");
          expect(reasoningEffort).toBe("max");
          expect(messages.at(-1)?.role).toBe("tool");
          return actionResponse("apply", "test_draft_operations", {
            baseRevision: 0,
            batch: {
              objective: "写入研究结论",
              operations: [{
                type: "set_metadata",
                metadata: { description: "依据三项公开资料建立的世界。" },
              }],
            },
          });
        }
        return actionResponse("finish", "finish", {
          summary: "研究资料已经进入草稿。",
          questions: ["是否继续补全其余结构？"],
        });
      },
    };
    const researchProvider: WebResearchProvider = {
      async search({ query }) {
        researchCalls++;
        return {
          summary: `${query}的检索摘要`,
          sources: [{
            title: query,
            url: `https://example.com/budget-${researchCalls}`,
            accessedAt: researchCalls,
            note: "用于建立世界",
          }],
        };
      },
    };

    const result = await new WorldArchitect(provider, {
      researchEnabled: true,
      researchProvider,
    }).run({
      draft: createEmptyWorldDraft({ id: "world:research-budget" }),
      instruction: "检索资料并创建世界。",
    });

    expect(modelCalls).toBe(3);
    expect(researchCalls).toBe(3);
    expect(result.changeSet?.operations).toHaveLength(1);
  });

  it("does not extend the configured step budget with synthetic continuation rounds", async () => {
    let calls = 0;
    const traceTypes: string[] = [];
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages, tools, toolChoice, thinking, reasoningEffort }) {
        calls++;
        expect(toolChoice).toBeUndefined();
        expect(thinking).toBe("enabled");
        expect(reasoningEffort).toBe("max");
        if (calls === 1) return actionResponse("research", "research_web", {
          query: "公开角色资料",
          purpose: "据此创建世界角色",
        });
        if (calls === 2) {
          expect(tools?.some((tool) => tool.function.name === "research_web")).toBe(true);
          expect(tools?.some((tool) => tool.function.name === "update_world_core")).toBe(true);
          expect(tools?.some((tool) => tool.function.name === "apply_draft_operations")).toBe(false);
          expect(messages.some((message) => message.role === "tool")).toBe(true);
          expect(toolChoice).toBeUndefined();
        }
        if (calls === 2) return actionResponse("inspect", "inspect_draft", {
          sections: ["metadata", "actors", "contexts"],
        });
        if (calls === 3) return actionResponse("apply", "test_draft_operations", {
          baseRevision: 0,
          batch: {
            objective: "建立世界基础",
            operations: [{
              type: "set_metadata",
              metadata: { description: "依据公开资料建立的测试世界。" },
            }],
          },
        });
        if (calls === 4) return actionResponse("validate", "validate_draft", {});
        return actionResponse("finish", "finish", {
          summary: "资料已转化为草稿修改。",
          questions: ["是否继续补全其余世界结构？"],
        });
      },
    };
    const result = await new WorldArchitect(provider, {
      maxToolRounds: 2,
      researchEnabled: true,
      trace: (event) => traceTypes.push(event.type),
      researchProvider: {
        async search() {
          return {
            summary: "可用于创作的公开资料摘要。",
            sources: [],
          };
        },
      },
    }).run({
      draft: createEmptyWorldDraft({ id: "world:research-budget" }),
      instruction: "检索资料，然后据此创建世界。",
    });

    expect(calls).toBe(2);
    expect(result.changeSet).toBeUndefined();
    expect(result.execution).toEqual({
      steps: 2,
      toolCalls: 2,
      stopReason: "round_limit",
    });
    expect(traceTypes).toContain("tool_start");
    expect(traceTypes).toContain("tool");
    expect(traceTypes.filter((type) => type === "step_end")).toHaveLength(2);
  });

  it("creates multiple bounded Markdown sources in one turn without mutating uploaded material", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat() {
        calls++;
        if (calls === 1) return actionResponse("inspect-source", "inspect_source_materials", { query: "山门" });
        if (calls === 2) return actionResponse("write-source", "write_source_documents", {
          name: "雨山世界索引",
          documents: [{
            path: "index.md",
            title: "世界索引",
            content: "# 世界索引\n\n## 地点\n\n山门是故事的入口。",
          }],
        });
        if (calls === 3) return actionResponse("write-source-characters", "write_source_documents", {
          name: "雨山人物索引",
          documents: [{
            path: "characters.md",
            title: "人物索引",
            content: "# 人物索引\n\n## 守门人\n\n守门人知道山门旧约的一部分。",
          }],
        });
        return actionResponse("finish-source", "finish", { summary: "已建立独立世界索引。" });
      },
    };
    const result = await new WorldArchitect(provider, {
      sourceMaterials: [{
        bundleId: "uploaded:1",
        revision: 1,
        origin: "user_import",
        documentId: "original.md",
        path: "original.md",
        title: "原始文档",
        content: "# 原文\n\n山门在雨中打开。",
      }],
    }).run({
      draft: createEmptyWorldDraft({ id: "world:sources" }),
      instruction: "读取原文并建立独立世界索引，不要修改原文。",
    });

    expect(calls).toBe(4);
    expect(result.sourceArtifacts).toEqual([
      expect.objectContaining({ mode: "create", revision: 1, name: "雨山世界索引" }),
      expect.objectContaining({ mode: "create", revision: 1, name: "雨山人物索引" }),
    ]);
    expect(result.sourceArtifacts?.[0]?.documents[0]?.content).toContain("山门是故事的入口");
    expect(result.sourceArtifacts?.[1]?.documents[0]?.content).toContain("守门人知道山门旧约");
  });

  it("ends naturally when the model returns prose without tool calls", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat() {
        calls++;
        if (calls === 1) {
          return {
            content: "我先梳理一下当前阶段。",
            toolCalls: [],
          };
        }
        if (calls === 2) return actionResponse("apply", "test_draft_operations", {
          baseRevision: 0,
          batch: {
            objective: "完成世界基础",
            operations: [{
              type: "set_metadata",
              metadata: { description: "已完成世界基础阶段。" },
            }],
          },
        });
        return actionResponse("finish", "finish", {
          summary: "基础阶段已写入草稿。",
          questions: ["下一阶段需要继续补全角色与开场。"],
        });
      },
    };
    const result = await new WorldArchitect(provider, { maxToolRounds: 1 }).run({
      draft: createEmptyWorldDraft({ id: "world:plan-continuation" }),
      instruction: "继续完成世界基础。",
      plan: {
        id: "plan:1",
        goal: "建立完整世界",
        items: [{ id: "item:1", title: "完成世界基础", scope: "foundation", status: "in_progress" }],
      },
    });

    expect(calls).toBe(1);
    expect(result.changeSet).toBeUndefined();
    expect(result.summary).toBe("我先梳理一下当前阶段。");
    expect(result.execution).toEqual({ steps: 1, toolCalls: 0, stopReason: "natural_response" });
  });

  it("repairs an invalid partial finish without requiring validation ceremony", async () => {
    let calls = 0;
    let generatedIds = 0;
    const draft = createEmptyWorldDraft({ id: "world:repair" });
    const contextId = draft.contexts[0]!.id;
    const actorId = "actor:repair";
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat() {
        calls++;
        if (calls === 1) return actionResponse("partial", "test_draft_operations", {
          baseRevision: 0,
          batch: {
            objective: "建立世界基础",
            operations: [{
              type: "set_metadata",
              metadata: { description: "尚待补全的世界。" },
            }],
          },
        });
        if (calls === 2) return actionResponse("early-finish", "finish", {
          summary: "完成。",
        });
        if (calls === 3) return actionResponse("repair-foundation", "test_draft_operations", {
          baseRevision: 1,
          batch: {
            objective: "补齐世界前提",
            operations: [{ type: "set_premise", premise: "旅人来到一座封印松动的山前。" }],
          },
        });
        if (calls === 4) return actionResponse("repair-actor", "test_draft_operations", {
          baseRevision: 2,
          batch: {
            objective: "建立主角",
            operations: [{ type: "upsert_actor", actor: { id: actorId, role: "lead", card: ACTOR } }],
          },
        });
        if (calls === 5) return actionResponse("repair-player", "test_draft_operations", {
          baseRevision: 3,
          batch: {
            objective: "建立玩家角色",
            operations: [{
              type: "upsert_player",
              player: {
                id: "world:repair:player",
                mode: "participant",
                profile: { name: "你", card: "误入山中的旅人" },
                playerCard: PLAYER_CARD,
              },
            }],
          },
        });
        if (calls === 6) return actionResponse("repair-context", "test_draft_operations", {
          baseRevision: 4,
          batch: {
            objective: "建立开场 Context",
            operations: [{
              type: "upsert_context",
              context: {
                id: contextId,
                name: "山脚",
                actorIds: [actorId, "world:repair:player"],
                scene: {
                  groupName: "修复世界",
                  topic: "封印松动",
                  atmosphere: "暮色压在山脊上",
                  state: "flowing",
                },
                opening: "暮色中，山腹传来锁链轻响。",
              },
            }],
          },
        });
        if (calls === 7) return actionResponse("repair-chapter", "test_draft_operations", {
          baseRevision: 5,
          batch: {
            objective: "建立开场剧情章节",
            operations: [{
              type: "upsert_chapter",
              chapter: {
                title: "封印为何松动",
                treatment: "来者必须在多场调查、试探和同行磨合中查明封印变化的原因，逐步面对山中旧势力与自身未知来历。",
                targetOutcome: "来者确认封印松动的直接原因，并决定是否共同进入山腹处理它。",
                actorIds: [actorId],
                contextIds: [contextId],
              },
            }],
          },
        });
        if (calls === 8) return actionResponse("repair-queued-chapter", "test_draft_operations", {
          baseRevision: 6,
          batch: {
            objective: "准备后续剧情章节",
            operations: [{
              type: "upsert_chapter",
              chapter: {
                id: "world:repair:chapter:follow-up",
                title: "进入山腹",
                treatment: "旅人与守门者在确认封印异常后，沿着山腹旧路逐步处理新的风险、资源和彼此的责任边界。后续剧情应通过多场探索、协商和现场反馈改变他们的行动条件，而不是用一次对话直接结束整段旅程。",
                targetOutcome: "旅人与守门者完成进入山腹前的共同准备，并确立可执行的继续行动约束。",
                status: "queued",
                actorIds: [actorId],
                contextIds: [contextId],
              },
            }],
          },
        });
        return actionResponse("finish", "finish", { summary: "世界已经补全。" });
      },
    };

    const result = await new WorldArchitect(provider, {
      maxToolRounds: 10,
      nextId: (prefix) => {
        if (prefix === "actor") return actorId;
        if (prefix === "player") return "world:repair:player";
        return `${prefix}:test:${++generatedIds}`;
      },
    }).run({
      draft,
      instruction: "创建一个可以运行的世界。",
    });

    expect(calls).toBe(9);
    expect(
      result.changeSet?.validation.valid,
      JSON.stringify({
        issues: result.changeSet?.validation.issues,
        operations: result.changeSet?.operations,
        receipts: result.batchReceipts,
      }),
    ).toBe(true);
    expect(result.execution.stopReason).toBe("finished");
  });

  it("keeps the same reasoning chain while the model repairs validation errors", async () => {
    const actorId = "world:stagnant-repair:actor";
    const playerId = "world:stagnant-repair:player";
    const contextId = "world:stagnant-repair:context:main";
    let calls = 0;
    let generatedIds = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages, tools, toolChoice, thinking, reasoningEffort }) {
        calls++;
        if (calls === 1) return actionResponse("foundation", "test_draft_operations", {
          baseRevision: 0,
          batch: {
            objective: "建立世界基础",
            operations: [
              { type: "set_metadata", metadata: { description: "一个等待补全开场的世界。" } },
              { type: "set_premise", premise: "旅人来到封印松动的山前。" },
              { type: "set_lore", lore: { core: "山中封印正在松动。", rules: [] } },
            ],
          },
        });
        if (calls === 2) return actionResponse("cast", "test_draft_operations", {
          baseRevision: 1,
          batch: {
            objective: "建立参与者",
            operations: [
              { type: "upsert_actor", actor: { id: actorId, role: "lead", card: ACTOR } },
              {
                type: "upsert_player",
                player: {
                  id: playerId,
                  mode: "participant",
                  profile: { name: "你", card: "误入山中的旅人" },
                  playerCard: PLAYER_CARD,
                },
              },
            ],
          },
        });
        if (calls === 3 || calls === 4) {
          return actionResponse(`validate-${calls}`, "validate_draft", {});
        }
        if (calls === 5) {
          expect(messages.at(-1)?.role).toBe("tool");
          expect(tools?.some((tool) => tool.function.name === "update_world_core")).toBe(true);
          expect(tools?.some((tool) => tool.function.name === "apply_draft_operations")).toBe(false);
          expect(toolChoice).toBeUndefined();
          expect(thinking).toBe("enabled");
          expect(reasoningEffort).toBe("max");
          return actionResponse("repair", "test_draft_operations", {
            baseRevision: 2,
            batch: {
              objective: "补齐开场",
              operations: [{
                type: "upsert_context",
                context: {
                  id: contextId,
                  name: "山脚",
                  actorIds: [actorId, playerId],
                  scene: {
                    groupName: "封印山",
                    topic: "封印松动",
                    atmosphere: "暮色压在山脊上",
                    state: "flowing",
                  },
                  opening: "暮色中，山腹传来锁链轻响。",
                },
              }],
            },
          });
        }
        if (calls === 6) {
          expect(thinking).toBe("enabled");
          expect(reasoningEffort).toBe("max");
          return actionResponse("repair-chapter", "test_draft_operations", {
            baseRevision: 3,
            batch: {
              objective: "补齐剧情章节",
              operations: [{
                type: "upsert_chapter",
                chapter: {
                  title: "封印为何松动",
                  treatment: "来者必须在多场调查、试探和同行磨合中查明封印变化的原因，逐步面对山中旧势力与自身未知来历。",
                  targetOutcome: "来者确认封印松动的直接原因，并决定是否共同进入山腹处理它。",
                  actorIds: [actorId],
                  contextIds: [contextId],
                },
              }],
            },
          });
        }
        if (calls === 7) {
          return actionResponse("repair-queued-chapter", "test_draft_operations", {
            baseRevision: 4,
            batch: {
              objective: "准备后续剧情章节",
              operations: [{
                type: "upsert_chapter",
                chapter: {
                  id: "world:stagnant-repair:chapter:follow-up",
                  title: "进入山腹",
                  treatment: "旅人与守门者在确认封印异常后，沿着山腹旧路逐步处理新的风险、资源和彼此的责任边界。后续剧情应通过多场探索、协商和现场反馈改变他们的行动条件，而不是用一次对话直接结束整段旅程。",
                  targetOutcome: "旅人与守门者完成进入山腹前的共同准备，并确立可执行的继续行动约束。",
                  status: "queued",
                  actorIds: [actorId],
                  contextIds: [contextId],
                },
              }],
            },
          });
        }
        return actionResponse("finish", "finish", { summary: "世界已经补全。" });
      },
    };

    const result = await new WorldArchitect(provider, {
      maxToolRounds: 8,
      nextId: (prefix) => {
        if (prefix === "actor") return actorId;
        if (prefix === "player") return playerId;
        return `${prefix}:test:${++generatedIds}`;
      },
    }).run({
      draft: createEmptyWorldDraft({ id: "world:stagnant-repair" }),
      instruction: "创建一个可以运行的世界。",
    });

    expect(calls).toBe(8);
    expect(
      result.changeSet?.validation.valid,
      JSON.stringify(result.changeSet?.validation.issues),
    ).toBe(true);
    expect(result.execution.stopReason).toBe("finished");
  });

  it("returns malformed tool arguments as an observation and lets the next model step repair them", async () => {
    let calls = 0;
    const commits: number[] = [];
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages }) {
        calls++;
        if (calls === 1) {
          return {
            content: "",
            reasoningContent: "先建立一个最小语义批次。",
            toolCalls: [{
              id: "broken-json",
              type: "function",
              function: {
                name: "update_world_core",
                arguments: '{"premise":',
              },
            }],
          };
        }
        if (calls === 2) {
          expect(
            [...messages].reverse().find((message) => message.role === "assistant")?.reasoningContent,
          ).toBe("先建立一个最小语义批次。");
          const observation = [...messages].reverse().find((message) => message.role === "tool");
          expect(observation?.content).toContain("Unexpected end of JSON input");
          expect(observation?.content).toContain("invalid_tool_arguments");
          return actionResponse("fixed", "test_draft_operations", {
            batch: {
              objective: "建立世界基础",
              operations: [{
                type: "set_metadata",
                metadata: { description: "分批写入后的世界。" },
              }],
            },
          });
        }
        return actionResponse("finish", "finish", {
          summary: "基础已经可靠写入。",
          questions: ["是否继续补全其余结构？"],
        });
      },
    };
    const result = await new WorldArchitect(provider, {
      maxToolRounds: 3,
      onBatchCommitted: ({ receipt }) => { commits.push(receipt.revision); },
    }).run({
      draft: createEmptyWorldDraft({ id: "world:json-repair" }),
      instruction: "建立世界基础。",
    });

    expect(calls).toBe(3);
    expect(commits).toEqual([1]);
    expect(result.batchReceipts).toEqual([expect.objectContaining({
      scope: "foundation",
      previousRevision: 0,
      revision: 1,
    })]);
    expect(result.execution.stopReason).toBe("finished");
  });

  it("uses the Host revision and does not expose revision bookkeeping to the model", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ tools }) {
        calls++;
        const coreTool = tools?.find((tool) => tool.function.name === "update_world_core");
        expect(tools?.some((tool) => tool.function.name === "apply_draft_operations")).toBe(false);
        const parameters = coreTool?.function.parameters as {
          required?: string[];
          properties?: Record<string, unknown>;
        };
        expect(parameters.required).toBeUndefined();
        expect(parameters.properties).not.toHaveProperty("baseRevision");
        if (calls === 1) {
          return actionResponse("first", "update_world_core", {
            metadata: { name: "Host Revision" },
          });
        }
        if (calls === 2) {
          return actionResponse("second", "update_world_core", {
            baseRevision: 0,
            premise: "第二批必须基于 Host 的最新草稿。",
          });
        }
        return actionResponse("finish", "finish", {
          summary: "两个批次均已写入。",
          questions: ["其余结构稍后补全。"],
        });
      },
    };
    const result = await new WorldArchitect(provider, { maxToolRounds: 3 }).run({
      draft: createEmptyWorldDraft({ id: "world:host-revision" }),
      instruction: "分两批建立基础。",
    });

    expect(result.workingDraft.revision).toBe(2);
    expect(result.batchReceipts?.map((receipt) => receipt.revision)).toEqual([1, 2]);
  });

  it("stops after two invalid tool argument responses instead of looping", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat() {
        calls++;
        return {
          content: "",
          toolCalls: [{
            id: `broken-${calls}`,
            type: "function",
            function: {
              name: "update_world_core",
              arguments: '{"premise":',
            },
          }],
        };
      },
    };
    const result = await new WorldArchitect(provider, { maxToolRounds: 10 }).run({
      draft: createEmptyWorldDraft({ id: "world:bounded-repair" }),
      instruction: "建立世界基础。",
    });

    expect(calls).toBe(2);
    expect(result.execution.stopReason).toBe("tool_input_error");
    expect(result.changeSet).toBeUndefined();
  });

  it("repairs a truncated tool call reported with max_tokens", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat() {
        calls++;
        if (calls === 1) {
          return {
            content: "",
            finishReason: "max_tokens",
            toolCalls: [{
              id: "truncated",
              type: "function",
              function: {
                name: "update_world_core",
                arguments: '{"premise":',
              },
            }],
          };
        }
        if (calls === 2) {
          return actionResponse("repaired", "update_world_core", {
            metadata: { description: "成功恢复。" },
          });
        }
        return actionResponse("finish", "finish", {
          summary: "截断批次已恢复。",
          questions: ["稍后继续补全。"],
        });
      },
    };
    const result = await new WorldArchitect(provider, { maxToolRounds: 3 }).run({
      draft: createEmptyWorldDraft({ id: "world:max-token-repair" }),
      instruction: "建立世界基础。",
    });

    expect(calls).toBe(3);
    expect(result.workingDraft.revision).toBe(1);
    expect(result.execution.stopReason).toBe("finished");
  });

  it("searches Markdown by line and reads only the requested range", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages }) {
        calls++;
        if (calls === 1) {
          return actionResponse("search", "inspect_source_materials", { query: "氧罐" });
        }
        const latestObservation = [...messages].reverse().find((message) => message.role === "tool");
        const observation = JSON.parse(latestObservation?.content ?? "{}") as Record<string, unknown>;
        if (calls === 2) {
          const hits = observation.hits as Array<{ startLine: number; endLine: number }>;
          expect(hits[0]).toEqual(expect.objectContaining({ startLine: 1, endLine: 5 }));
          return actionResponse("read", "read_source_material", {
            documentId: "timeline.md",
            startLine: 2,
            endLine: 4,
          });
        }
        if (calls === 3) {
          expect(observation).toEqual(expect.objectContaining({
            startLine: 2,
            endLine: 4,
            totalLines: 5,
          }));
          expect(String(observation.content)).toContain("氧罐压力下降");
        }
        return actionResponse("finish", "finish", { summary: "资料片段已经读取。" });
      },
    };
    await new WorldArchitect(provider, {
      sourceMaterials: [{
        bundleId: "apollo",
        revision: 1,
        origin: "user_import",
        documentId: "timeline.md",
        path: "timeline.md",
        title: "任务时间线",
        content: ["# 时间线", "", "55:53 氧罐压力下降", "55:55 乘组报告异常", "后续仍待确认"].join("\n"),
      }],
    }).run({
      draft: createEmptyWorldDraft({ id: "world:line-read" }),
      instruction: "确认氧罐异常发生在哪几行。",
    });

    expect(calls).toBe(3);
  });

  it("commits world core and player card through separate domain tools", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() { return ""; },
      async *stream() { /* Not used. */ },
      async chat({ messages }) {
        calls++;
        if (calls === 1) {
          return actionResponse("core", "update_world_core", {
            metadata: { name: "领域工具世界" },
            premise: "一个被雨幕隔绝的山门世界。",
          });
        }
        if (calls === 2) {
          return actionResponse("player", "save_player_card", {
            player: { id: "player", mode: "participant", profile: { name: "旅人" } },
          });
        }
        const tool = [...messages].reverse().find((message) => message.role === "tool");
        const observation = JSON.parse(tool?.content ?? "{}") as { revision: number };
        expect(observation.revision).toBe(2);
        return actionResponse("finish", "finish", {
          summary: "混合批次已经提交。",
          questions: ["是否继续补全角色与开场？"],
        });
      },
    };

    const result = await new WorldArchitect(provider, { maxToolRounds: 3 }).run({
      draft: createEmptyWorldDraft({ id: "world:semantic-prefix" }),
      instruction: "建立世界基础和玩家。",
    });

    expect(calls).toBe(3);
    expect(result.workingDraft.revision).toBe(2);
    expect(result.workingDraft.premise).toBe("一个被雨幕隔绝的山门世界。");
    expect(result.workingDraft.player?.profile.name).toBe("旅人");
    expect(result.batchReceipts?.map((receipt) => receipt.scope)).toEqual(["foundation", "player"]);
  });
});

function actionResponse(id: string, name: string, args: Record<string, unknown>) {
  if (name === "test_draft_operations") {
    const batch = args.batch as { operations?: Array<Record<string, unknown>> } | undefined;
    return {
      content: "",
      toolCalls: draftOperationToolCalls(id, batch?.operations ?? []),
    };
  }
  return {
    content: "",
    toolCalls: [toolCall(id, name, args)],
  };
}

function draftOperationToolCalls(
  id: string,
  operations: Array<Record<string, unknown>>,
) {
  const calls: ReturnType<typeof toolCall>[] = [];
  const core: Record<string, unknown> = {};
  const relations: unknown[] = [];
  const removals: Record<string, unknown[]> = {
    actorIds: [],
    relationIds: [],
    chapterIds: [],
  };
  for (const operation of operations) {
    switch (operation.type) {
      case "set_metadata": core.metadata = operation.metadata; break;
      case "set_premise":
        core.premise = typeof operation.premise === "object"
          ? (operation.premise as { text?: unknown }).text
          : operation.premise;
        break;
      case "set_lore": core.lore = operation.lore; break;
      case "upsert_player":
        calls.push(toolCall(`${id}-player`, "save_player_card", { player: operation.player }));
        break;
      case "remove_player":
        calls.push(toolCall(`${id}-remove-player`, "remove_draft_entities", { removePlayer: true }));
        break;
      case "upsert_actor":
        calls.push(toolCall(`${id}-actor-${calls.length}`, "save_actor", { actor: operation.actor }));
        break;
      case "remove_actor": (removals.actorIds as unknown[]).push(operation.actorId); break;
      case "upsert_relation": relations.push(operation.relation); break;
      case "remove_relation": (removals.relationIds as unknown[]).push(operation.relationId); break;
      case "upsert_context":
        calls.push(toolCall(`${id}-context`, "save_context", { context: operation.context }));
        break;
      case "upsert_chapter":
        calls.push(toolCall(`${id}-chapter-${calls.length}`, "save_chapter", { chapter: operation.chapter }));
        break;
      case "remove_chapter": (removals.chapterIds as unknown[]).push(operation.chapterId); break;
      case "set_runtime_profile":
        calls.push(toolCall(`${id}-runtime`, "set_runtime_profile", {
          runtimeProfile: operation.runtimeProfile,
        }));
        break;
    }
  }
  if (Object.keys(core).length) calls.unshift(toolCall(`${id}-core`, "update_world_core", core));
  if (relations.length) calls.push(toolCall(`${id}-relations`, "save_relations", { relations }));
  if (Object.values(removals).some((values) => values.length)) {
    calls.push(toolCall(`${id}-remove`, "remove_draft_entities", removals));
  }
  return calls;
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}
