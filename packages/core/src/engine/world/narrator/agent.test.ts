import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../../../contracts/provider.js";
import type { NarrativeBeat } from "../../../contracts/world.js";
import { createDirectorReferenceTable } from "../director/references.js";
import { WorldNarrator, type NarratorView } from "./agent.js";

const beat: NarrativeBeat = {
  id: "beat-1",
  chapterId: "chapter-1",
  title: "山口异响",
  brief: "行人抵达山口，并确认异响来自何处。",
  script: {
    time: "黄昏",
    location: "五行山山口",
    cast: [{ actorId: "actor-1", roleInScene: "确认异响来源" }],
    cause: "山道上传来持续逼近的异响。",
    development: ["异响逼近。", "行人寻找来源。", "来源显露。"],
    stages: [
      {
        id: "locate",
        purpose: "定位异响",
        entryCondition: "异响已经逼近",
        developments: ["检查石缝与山道"],
        expectedChange: "异响来源的位置被确认",
      },
      {
        id: "identify",
        purpose: "确认来源身份",
        entryCondition: "已经定位来源",
        developments: ["观察并辨认来源"],
        expectedChange: "异响来源的身份被确认",
      },
    ],
    turningPoint: "异响来源出现在众人眼前。",
    result: "异响来源已被确认。",
    nextPressure: "山道另一端出现新的阻碍。",
    causalChain: ["异响逼近迫使行人停步。", "调查使来源显露。", "来源显露后通行选择改变。"],
  },
  completesChapter: false,
  minimumActorTurns: 8,
  maximumActorTurns: 14,
  contextIds: ["context-1"],
  actorIds: ["actor-1"],
  sourceEventIds: ["event-1"],
  status: "running",
  occurredAt: 1,
};

function view(overrides: Partial<NarratorView> = {}): NarratorView {
  const references = createDirectorReferenceTable({
    actorIds: ["actor-1"],
    contextIds: ["context-1"],
    chapterIds: ["chapter-1"],
    beatIds: ["beat-1"],
    eventIds: ["event-1"],
  });
  return {
    world: "五行山\n暮色中的山路。",
    context: "山脚\n山风穿过乱石。",
    beat,
    sceneNow: "石缝里传来声响。",
    cast: "孙悟空 [actor] | role=被压在山下的猴王",
    availableActorIds: ["actor-1"],
    actorNamesById: new Map([["actor-1", "孙悟空"]]),
    references,
    timeline: "【旁白】：山风掠过碎石，石缝里传来一声轻响。",
    triggerEvents: "E1 context.message.committed world: 有人来了。",
    triggerSource: "world",
    ambient: {
      triggered: false,
      noopCount: 0,
    },
    progress: {
      actorTurns: 2,
      minimumActorTurns: 8,
      maximumActorTurns: 14,
      actorTurnsSinceNarration: 2,
    },
    ...overrides,
  };
}

function createCapturingProvider(prompts: string[], systems: string[] = []): ChatProvider {
  return {
    async complete({ systemPrompt, userPrompt }) {
      systems.push(systemPrompt);
      prompts.push(userPrompt);
      return JSON.stringify({
        narration: null,
        sceneNow: "石缝里传来声响。",
        wakes: [{ actorId: "孙悟空", urgency: "relevant", guidance: "确认石缝中的声响来源。", requiresResponse: false }],
        playerTurn: null,
        directorRequest: null,
        beatStatus: "continue",
        outcome: null,
      });
    },
    async *stream() {
      yield "";
    },
    async chat() {
      return { content: null, toolCalls: [] };
    },
  };
}

describe("WorldNarrator prompt layout", () => {
  it("locks narration to the earliest unfinished stage and keeps next pressure out of the active Beat", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("resolve_action", view());

    expect(systems[0]).toContain("只执行最早未完成的一阶段");
    expect(systems[0]).toContain("该阶段永久完成");
    expect(systems[0]).toContain("nextPressure 不是当前幕任务");
    expect(systems[0]).toContain("角色回合数是安全边界而非台词配额");
    expect(prompts[0]).toContain("Only the earliest unfinished stage is active");
    expect(prompts[0]).toContain("afterClosurePressure=山道另一端出现新的阻碍。 [LOCKED until result is established");
    expect(prompts[0]).toContain("[Script adherence check]");
    expect(prompts[0]).toContain("若本批已经完成当前 stage");
  });

  it("treats a character's committed decision as observable completion evidence", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("check_closure", view());

    expect(systems[0]).toContain("已提交的决定、命令、承诺、拒绝和动作只证明本人这样做过");
    expect(systems[0]).toContain("不附加复核或新障碍");
    expect(systems[0]).toContain("beatStatus 只描述调用开始前已经提交的状态");
    expect(systems[0]).toContain("只要仍需任何 Actor 或玩家完成 guidance");
    expect(systems[0]).toContain("必须返回 continue");
  });

  it("keeps the stable Beat context before per-turn state", async () => {
    const prompts: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts));

    await narrator.run("open_beat", view());
    await narrator.run("check_closure", view({
      sceneNow: "唐三藏已经勒马停下。",
      triggerEvents: "event-3 context.message.committed: 阿弥陀佛。",
      progress: {
        actorTurns: 4,
        minimumActorTurns: 8,
        maximumActorTurns: 14,
        actorTurnsSinceNarration: 1,
      },
    }));

    expect(prompts).toHaveLength(2);
    const stableEnd = prompts[0]!.indexOf("[Turn state]");
    expect(stableEnd).toBeGreaterThan(0);
    expect(prompts[0]!.slice(0, stableEnd)).toBe(prompts[1]!.slice(0, stableEnd));
    expect(prompts[0]!.indexOf("[Mode]")).toBeGreaterThan(stableEnd);
    expect(prompts[0]!.indexOf("[Scene now]")).toBeGreaterThan(stableEnd);
    expect(prompts[0]!.indexOf("[Current trigger events]"))
      .toBeGreaterThan(prompts[0]!.indexOf("[Scene now]"));
    expect(prompts[0]!.indexOf("[Timeline]"))
      .toBeGreaterThan(prompts[0]!.indexOf("[Current trigger events]"));
    expect(prompts[0]).toContain("cause=山道上传来持续逼近的异响");
    expect(prompts[0]).toContain("1. 异响逼近");
    expect(prompts[0]).toContain("turningPoint=异响来源出现在众人眼前");
    expect(prompts[0]).toContain("result=异响来源已被确认");
    expect(prompts[0]).toContain("本批只在这里出现，处理一次");
    expect(prompts[0]).toContain("仅为本批触发之前的历史，不得重演");
    expect(prompts[0]).not.toContain("[Trigger]");
  });

  it("rejects the Actor already at the Galgame queue tail when another Actor is available", async () => {
    const prompts: string[] = [];
    let calls = 0;
    const provider: ChatProvider = {
      async complete({ userPrompt }) {
        prompts.push(userPrompt);
        calls++;
        const actorId = calls === 1 ? "孙悟空" : "唐三藏";
        return JSON.stringify({
          narration: null,
          sceneNow: "两人仍在山口核对异响。",
          wakes: [{ actorId, urgency: "relevant", guidance: "接过当前话题。", requiresResponse: false }],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };
    const narrator = new WorldNarrator(provider);

    const result = await narrator.run("resolve_action", view({
      presentation: "galgame",
      cast: "孙悟空 [actor]\n唐三藏 [actor]",
      availableActorIds: ["actor-2"],
      actorNamesById: new Map([["actor-1", "孙悟空"], ["actor-2", "唐三藏"]]),
      immediatePreviousActorId: "actor-1",
      references: createDirectorReferenceTable({
        actorIds: ["actor-1", "actor-2"],
        contextIds: ["context-1"],
        chapterIds: ["chapter-1"],
        beatIds: ["beat-1"],
        eventIds: ["event-1"],
      }),
    }));

    expect(calls).toBe(2);
    expect(result.wakes.map((wake) => wake.actorId)).toEqual(["actor-2"]);
    expect(prompts[0]).toContain("actor=孙悟空");
    expect(prompts[0]).toContain("本轮不得再次 wake");
  });

  it("keeps factual corrections and role dialogue inside the proper boundaries", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("resolve_action", view({
      sceneNow: "氧气余量仍按旧记录显示。",
      triggerEvents: [
        "[Current trigger events]",
        "event-4 world.event.emitted: 最新检测确认氧气只剩16分钟。",
      ].join("\n"),
    }));

    expect(prompts[0]).toContain("最新检测确认氧气只剩16分钟");
    expect(systems[0]).toContain("Current trigger events 优先于旧 sceneNow");
    expect(systems[0]).toContain("角色需要说话、判断、承诺、拒绝、决定或主动行动时，一律 wake");
    expect(systems[0]).toContain("不能新增任何人物未提交的言行、想法或选择");
  });

  it("forbids narration from speaking or acting for every defined Actor", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("open_beat", view({
      cast: "player: 旅人 [player] - 初到此地\nactor-1: 孙悟空 [actor] - 被压在山下",
    }));

    const system = systems[0]!;
    expect(system).toContain("Public cast 中每个已定义 Actor");
    expect(system).toContain("不得使用引号、冒号台词、间接引语");
    expect(system).toContain("不得替玩家观察、判断、同意、拒绝或行动");
    expect(system).toContain("需要其表达或行动时必须 wake 对应 Actor");
    expect(system).toContain("只代表需要交给该 Actor 的未来责任");
    expect(system).toContain("不得使用引号、冒号台词、间接引语");
    expect(system).toContain("Narrator 绝对不能替任何人物或玩家说话");
    expect(system).toContain("不得把语言伪装成声音、通讯、回忆、文书内容或心理描写");
    expect(system).toContain("没有可写的新环境事实时 narration 必须为 null");
    expect(system).toContain("绝对不能替任何人物或玩家说话");
    expect(system).toContain("旁白中禁止一切人物语言和转述，没有例外");
    expect(system).toContain("由 Director 在下一幕创建角色");
  });

  it("keeps absent witness requests inside the planned Beat without幕内 Director support", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("resolve_action", view({
      cast: "actor-1: 守门人 - 没有离开过城门",
      triggerEvents: "event-6 context.message.committed: 请找一个刚从东路回来、能说明亲眼所见的人。",
      triggerSource: "player",
    }));

    expect(systems[0]).toContain("不得请求幕内 Director 支援");
    expect(systems[0]).toContain("不得让 Public cast 角色凭空兼任陌生经历");
    expect(prompts[0]).toContain("缺少不可替代资格时不得让现有角色代答");
    expect(prompts[0]).toContain("未进场传讯");
    expect(prompts[0]).toContain("确实需要新角色持续互动才收束并 transition_beat");
    expect(systems[0]).toContain("玩家刚提交内容时不得把同一回合立刻退回玩家");
    expect(systems[0]).toContain("player 与 actor 的参与者在仲裁上完全等价");
    expect(systems[0]).toContain("标记只决定 Runtime");
    expect(prompts[0]).toContain("source=player 是待处理的玩家表达");
    expect(prompts[0]).toContain("不得再次 wake 玩家");
    expect(prompts[0]).toContain("没有合格 Actor 时不要让在场角色伪造代答");
    const prompt = prompts[0]!;
    expect(prompt.indexOf("[Final routing checkpoint]")).toBeLessThan(
      prompt.indexOf("[Current trigger events]"),
    );
  });

  it("treats player and model-controlled actors as equal routing candidates", async () => {
    const prompts: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts));

    await narrator.run("resolve_action", view({
      presentation: "galgame",
      cast: "player: 旅人 [player] - 初到此地的见证者\nactor-1: 守门人 [actor] - 负责城门",
      triggerSource: "actor",
    }));

    expect(prompts[0]).toContain("player 与 actor 都从 Eligible wake Actor IDs 中按同一标准选择");
    expect(prompts[0]).toContain("无需等待 NPC 先点名玩家");
    expect(prompts[0]).toContain("不要求 Actor 先显式点名玩家");
    expect(prompts[0]).not.toContain("Player interaction preference");
  });

  it("requires a fresh opening narration for every new Beat", async () => {
    const prompts: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts));

    await narrator.run("open_beat", view({
      sceneNow: "暮色中的山路已经出现马蹄声。",
      timeline: "【旁白】：暮色中的山路已经出现马蹄声。",
    }));

    expect(prompts[0]).toContain("这是新 Beat 的第一轮");
    expect(prompts[0]).toContain("先写一段不重复上一幕的开场旁白");
  });

  it("gives closure-specific guidance without changing the stable Beat prefix", async () => {
    const prompts: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts));

    await narrator.run("resolve_action", view());
    await narrator.run("check_closure", view({
      progress: {
        actorTurns: 8,
        minimumActorTurns: 8,
        maximumActorTurns: 8,
        actorTurnsSinceNarration: 4,
      },
    }));

    expect(prompts[0]).toContain("只邀请完成当前最小动作所需的一人");
    expect(prompts[1]).toContain("本轮禁止 wakes");
    expect(prompts[1]).toContain("必须返回 beatStatus=complete");
    expect(prompts[1]).toContain("不得继续探索、铺垫、交换意见");
    expect(prompts[1]).toContain("result=异响来源已被确认");
    expect(prompts[1]).toContain("尚未完全实现时不得伪造");
    expect(prompts[1]).toContain("wakes 必须为空");
    const stableEnd = prompts[0]!.indexOf("[Turn state]");
    expect(prompts[0]!.slice(0, stableEnd)).toBe(prompts[1]!.slice(0, stableEnd));
  });

  it("does not force closure when only the minimum interaction count is reached", async () => {
    const prompts: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts));

    await narrator.run("check_closure", view({
      progress: {
        actorTurns: 8,
        minimumActorTurns: 8,
        maximumActorTurns: 14,
        actorTurnsSinceNarration: 1,
      },
    }));

    expect(prompts[0]).toContain("已达到 minimumActorTurns，但尚未达到 maximumActorTurns");
    expect(prompts[0]).toContain("不要因为刚过最小值就强行收束");
    expect(prompts[0]).not.toContain("本幕已达到 maximumActorTurns");
  });

  it("asks for one decisive result instead of explanatory padding when a Beat is dragging", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("check_closure", view({
      progress: {
        actorTurns: 7,
        minimumActorTurns: 8,
        maximumActorTurns: 14,
        actorTurnsSinceNarration: 4,
      },
    }));

    expect(prompts[0]).toContain("有合格责任人就只 wake 一人交付");
    expect(prompts[0]).toContain("禁止再次选择他补充说明");
    expect(prompts[0]).toContain("直接用旁白落实");
    expect(prompts[0]).toContain("旁白不能只解释旧内容");
    expect(systems[0]).toContain("每轮只转移一次责任");
    expect(systems[0]).toContain("上一责任已完成");
    expect(systems[0]).toContain("不得再次唤醒同一人换词补充");
    expect(systems[0]).toContain("这是给被唤醒者的单次直接执行指令");
    expect(systems[0]).toContain("必须明确写出剧本当前步骤、要处理的对象或输入");
    expect(systems[0]).toContain("不要让角色自己猜下一步");
  });

  it("turns an ambient checkpoint into one concrete continuation instead of repeated scenery", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("check_closure", view({
      ambient: { triggered: true, noopCount: 1 },
    }));

    expect(prompts[0]).toContain("triggered=true");
    expect(prompts[0]).toContain("选择唯一一名能立即交付新结果的角色");
    expect(prompts[0]).toContain("[Timeline]");
    expect(systems[0]).toContain("近义重写");
    expect(systems[0]).toContain("旁白落实下一项 development");
    expect(systems[0]).toContain("同一轮最多一段");
    expect(systems[0]).toContain("open_beat 必须给新开幕旁白");
  });

  it("allows consequential narration to break a stalled scene without inventing offstage dialogue", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("check_closure", view({
      cast: "actor-1: 守门人 - 没有离开过城门",
      progress: {
        actorTurns: 7,
        minimumActorTurns: 8,
        maximumActorTurns: 14,
        actorTurnsSinceNarration: 4,
      },
    }));

    expect(systems[0]).toContain("局面明显停滞");
    expect(systems[0]).toContain("既存文书、录音、广播或报告");
    expect(systems[0]).toContain("不得复述其中任何人物语言");
    expect(systems[0]).toContain("需要未生成角色说话就换幕创建");
    expect(prompts[0]).toContain("未进场来源的信息");
    expect(prompts[0]).toContain("直接用旁白落实");
  });

  it("keeps sceneNow updates silent and avoids unsupported causal conclusions", async () => {
    const prompts: string[] = [];
    const systems: string[] = [];
    const narrator = new WorldNarrator(createCapturingProvider(prompts, systems));

    await narrator.run("resolve_action", view({
      sceneNow: "命令来源仍未确认，舱门告警已经停止。",
      timeline: "【林岚】：先暂缓开门，维持生命窗口。\n【周沉】：证据链还没有闭合。",
      triggerEvents: "event-5 context.message.committed: 周沉提交了比对结果，仍无法确认触发源。",
    }));

    expect(systems[0]).toContain("没有新内容就为 null");
    expect(systems[0]).toContain("判断只是主张");
    expect(systems[0]).toContain("sceneNow：最多三句话");
  });

  it("repairs a truncated response once with a larger output budget", async () => {
    const requests: Array<{ maxTokens?: number; userPrompt: string }> = [];
    const provider: ChatProvider = {
      async complete(request) {
        requests.push({ maxTokens: request.maxTokens, userPrompt: request.userPrompt });
        if (requests.length === 1) return '{"narration":null,"sceneNow":"石缝震动';
        return JSON.stringify({
          narration: null,
          sceneNow: "石缝仍在震动。",
          wakes: [{ actorId: "孙悟空", urgency: "relevant", guidance: "确认石缝中的声响。", requiresResponse: false }],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    const result = await new WorldNarrator(provider).run("resolve_action", view());

    expect(requests).toHaveLength(2);
    expect(requests.every(({ maxTokens }) => maxTokens === 700)).toBe(true);
    expect(requests[1]!.userPrompt).toContain("[Output repair]");
    expect(result.sceneNow).toBe("石缝仍在震动。");
  });

  it("repairs narration that contains character speech", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() {
        calls++;
        return JSON.stringify(calls === 1 ? {
          narration: "校尉低声说道：“船影不像运粮船。”",
          sceneNow: "校尉正在观察江面。",
          wakes: [],
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        } : {
          narration: null,
          sceneNow: "江面船影间距整齐，校尉正在观察。",
          wakes: [{ actorId: "孙悟空", urgency: "direct", guidance: "报告你对船影队形的判断。", requiresResponse: true }],
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    const result = await new WorldNarrator(provider).run("resolve_action", view());

    expect(calls).toBe(2);
    expect(result.narration).toBeUndefined();
    expect(result.wakes[0]?.actorId).toBe("actor-1");
  });

  it("uses minimal reasoning with a larger budget when thinking cannot be disabled", async () => {
    const requests: Array<{ maxTokens?: number; reasoningEffort?: string }> = [];
    const provider: ChatProvider = {
      profile: {
        compatibility: { supportsThinkingDisable: false, supportsReasoningEffort: false },
        maxOutputTokens: 32_768,
      } as ChatProvider["profile"],
      async complete(request) {
        requests.push({ maxTokens: request.maxTokens, reasoningEffort: request.reasoningEffort });
        return JSON.stringify({
          narration: "夜风掠过荒寺残破的窗纸。",
          sceneNow: "宁采臣刚进入兰若寺，殿内空寂。",
          wakes: [{ actorId: "孙悟空", urgency: "relevant", guidance: "检查殿内可供落脚的位置。", requiresResponse: true }],
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    await new WorldNarrator(provider).run("open_beat", view({ maxTokens: 900 }));

    expect(requests).toEqual([{ maxTokens: 4_000, reasoningEffort: "off" }]);
  });

  it("accepts a JSON object surrounded by provider prose without retrying", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      async complete() {
        calls++;
        return `结果如下：\n${JSON.stringify({
          narration: null,
          sceneNow: "山风停了。",
          wakes: [{ actorId: "孙悟空", urgency: "relevant", guidance: "确认山风变化。", requiresResponse: false }],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        })}\n请查收。`;
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    const result = await new WorldNarrator(provider).run("resolve_action", view());

    expect(calls).toBe(1);
    expect(result.sceneNow).toBe("山风停了。");
  });

  it("falls back once when a provider rejects JSON mode and caches the capability", async () => {
    const formats: boolean[] = [];
    const provider: ChatProvider = {
      async complete({ responseFormat }) {
        formats.push(Boolean(responseFormat));
        if (responseFormat) {
          throw Object.assign(new Error("response_format json_object unsupported"), { status: 400 });
        }
        return JSON.stringify({
          narration: null,
          sceneNow: "石缝里传来声响。",
          wakes: [{ actorId: "孙悟空", urgency: "relevant", guidance: "确认石缝里的声响。", requiresResponse: false }],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };
    const narrator = new WorldNarrator(provider);

    await narrator.run("resolve_action", view());
    await narrator.run("check_closure", view());

    expect(formats).toEqual([true, false, false]);
  });

  it("rejects an empty continue after the repair attempt", async () => {
    const provider: ChatProvider = {
      async complete() {
        return JSON.stringify({
          narration: null,
          sceneNow: "石缝仍然安静。",
          wakes: [],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    await expect(new WorldNarrator(provider).run("resolve_action", view()))
      .rejects.toThrow("empty continue");
  });

  it("rejects a completed Beat that also selects another participant", async () => {
    const provider: ChatProvider = {
      async complete() {
        return JSON.stringify({
          narration: null,
          sceneNow: "异响来源已经确认。",
          wakes: [{ actorId: "孙悟空", urgency: "relevant", guidance: "继续补充。", requiresResponse: false }],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "complete",
          outcome: "异响来自石缝。",
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    await expect(new WorldNarrator(provider).run("check_closure", view()))
      .rejects.toThrow("cannot select another participant");
  });

  it("accepts omitted nullable fields and derives a completed outcome from sceneNow", async () => {
    const provider: ChatProvider = {
      async complete() {
        return JSON.stringify({
          sceneNow: "异响来源已经确认，守门人仍未到场。",
          wakes: [],
          beatStatus: "complete",
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    await expect(new WorldNarrator(provider).run("check_closure", view()))
      .resolves.toEqual({
        sceneNow: "异响来源已经确认，守门人仍未到场。",
        wakes: [],
        beatStatus: "complete",
        outcome: "异响来源已经确认，守门人仍未到场。",
      });
  });

  it("rejects the removed support_current_beat protocol", async () => {
    const provider: ChatProvider = {
      async complete() {
        return JSON.stringify({
          narration: null,
          sceneNow: "石缝中的异响仍未定位。",
          wakes: [],
          playerTurn: null,
          directorRequest: {
            kind: "support_current_beat",
            objective: "让巡山路径出现一条可观察的新线索。",
            reason: "当前角色只能重复等待，幕内需要一个外部变化。",
          },
          beatStatus: "continue",
          outcome: null,
        });
      },
      async *stream() { yield ""; },
      async chat() { return { content: null, toolCalls: [] }; },
    };

    await expect(new WorldNarrator(provider).run("resolve_action", view()))
      .rejects.toThrow("directorRequest requires kind, objective, and reason");
  });
});
