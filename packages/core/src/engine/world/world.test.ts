import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../../contracts/provider.js";
import type {
  NarrativeBeat,
  WorldDefinition,
  WorldSnapshot,
  WorldSourceProvider,
} from "../../contracts/world.js";
import { ChatVerse } from "../chatverse.js";
import type { Session } from "../session.js";
import { worldDefinitionFromGroup } from "../../group/to-world.js";
import { ActorGenerationCoordinator } from "./actor-coordinator.js";
import { worldDirectorTools } from "./director/tools.js";
import { ManualRuntimeHost } from "../../runtime/in-process.js";

const passiveProvider: ChatProvider = {
  async complete() {
    return JSON.stringify({ type: "silent", reason: "test" });
  },
  async *stream() {
    // Not used.
  },
  async chat() {
    return { content: "", toolCalls: [] };
  },
};

describe("worldDefinitionFromGroup", () => {
  it("creates a stable autonomous one-context world from a group", () => {
    const world = worldDefinitionFromGroup({
      kind: "chatverse.group",
      schemaVersion: 1,
      metadata: { id: "test-group", name: "Test Group" },
      characters: [{
        name: "Alice",
        description: "",
        personality: "",
        scenario: "",
          messageExample: "",
      }],
      userProfiles: [{ name: "Player", card: "A participant" }],
      scene: {
        groupName: "Test Group",
        topic: "Testing",
        atmosphere: "quiet",
      },
      relations: { relations: [{ from: "Alice", to: "Player", description: "knows" }] },
      runtime: { pacing: { multiplier: 3 } },
    });

    expect(world.metadata.id).toBe("test-group");
    expect(world.contexts).toHaveLength(1);
    expect(world.contexts[0]?.initiallyActive).toBe(true);
    expect(world.contexts[0]?.runtime?.pacingMultiplier).toBe(3);
    expect(world.directorPolicy?.enabled).toBe(false);
    expect(world.actorMemoryPolicy?.enabled).toBe(false);
    expect(world.actors.map((actor) => actor.id)).toEqual([
      "test-group:actor:1",
      "test-group:player:1",
    ]);
    expect(world.relations).toEqual([{
      fromActorId: "test-group:actor:1",
      toActorId: "test-group:player:1",
      description: "knows",
    }]);
  });

  it("defaults converted groups to a Director-free Harness world", () => {
    const world = worldDefinitionFromGroup({
      kind: "chatverse.group",
      schemaVersion: 1,
      metadata: { id: "plain-chat", name: "Plain Chat" },
      characters: [],
      scene: {
        groupName: "Plain Chat",
        topic: "Daily",
        atmosphere: "casual",
      },
    });

    expect(world.directorPolicy?.enabled).toBe(false);
    expect(world.actorMemoryPolicy?.enabled).toBe(false);
    expect(world.contexts[0]?.initiallyActive).toBe(true);
  });

  it("uses the Group Harness prompt for an autonomous Group Context", async () => {
    const prompts: string[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt }) {
        prompts.push(systemPrompt);
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "我先接一句。" }],
        });
      },
    };
    const definition = worldDefinitionFromGroup({
      kind: "chatverse.group",
      schemaVersion: 1,
      metadata: { id: "group-prompt", name: "Group Prompt" },
      characters: [
        {
          name: "Alice",
          description: "测试角色",
          personality: "自然",
          scenario: "正在群聊中",
          messageExample: "我先接一句。",
        },
        {
          name: "Bob",
          description: "测试角色",
          personality: "自然",
          scenario: "正在群聊中",
          messageExample: "我补充一句。",
        },
      ],
      userProfiles: [{ name: "Player", card: "群聊参与者" }],
      scene: {
        groupName: "Group Prompt",
        topic: "测试",
        atmosphere: "自然",
      },
      runtime: { pacing: { multiplier: 0 } },
    });
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.start();
    world.sendMessage({
      contextId: definition.contexts[0]!.id,
      actorId: "group-prompt:player:1",
      message: "大家好。",
    });

    await waitFor(() => prompts.length > 0, 5_000);
    world.stop();

    expect(prompts[0]).toContain("你现在在为 ChatVerse 返回一次角色发言决策");
    expect(prompts[0]).not.toContain("世界 Actor 决策");
  });

  it("keeps a Group context independent from the World pause lifecycle", () => {
    const definition = worldDefinitionFromGroup({
      kind: "chatverse.group",
      schemaVersion: 1,
      metadata: { id: "independent-chat", name: "Independent Chat" },
      characters: [{
        name: "Alice",
        description: "",
        personality: "",
        scenario: "",
        messageExample: "",
      }],
      scene: { groupName: "Independent Chat", topic: "Testing", atmosphere: "quiet" },
    });
    const contextId = definition.contexts[0]!.id;
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(definition);

    world.start();
    world.pause();
    expect(world.status).toBe("paused");
    expect(world.snapshot().contexts[0]?.status).toBe("active");

    world.pauseContext(contextId, "unread");
    expect(world.snapshot().contexts[0]).toMatchObject({
      status: "paused",
      pauseReason: "unread",
    });
    world.resume();
    expect(world.snapshot().contexts[0]?.status).toBe("paused");

    world.resumeContext(contextId);
    expect(world.snapshot().contexts[0]).toMatchObject({ status: "active" });
    expect(world.snapshot().contexts[0]?.pauseReason).toBeUndefined();
    world.stop();
  });
});

describe("World event stream", () => {
  it("pauses once on a billing failure instead of retrying the Director", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        calls++;
        throw Object.assign(new Error("insufficient balance"), {
          status: 402,
          code: "insufficient_quota",
        });
      },
    };
    const definition = humanOnlyWorld();
    definition.directorPolicy = { enabled: true, debounceMs: 0, minIntervalMs: 0 };
    const world = new ChatVerse({ provider }).createWorld(definition);
    const notifications: string[] = [];
    world.onNotification((notification) => notifications.push(notification.type));

    world.start();
    world.requestProgression({ contextId: "chat", reason: "observer_continue" });
    await waitFor(() => world.status === "paused");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(calls).toBe(1);
    expect(notifications.filter((type) => type === "provider.blocked")).toHaveLength(1);
    expect(notifications).not.toContain("director.retry_scheduled");
    expect(world.getForegroundRecovery("chat")).toMatchObject({
      operation: "director",
      status: "failed",
      failure: { kind: "provider", retryable: false },
    });
    world.stop();
  });

  it("uses the World actor prompt without changing Group sessions", async () => {
    let actorSystemPrompt = "";
    let actorUserPrompt = "";
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt, userPrompt }) {
        actorSystemPrompt = systemPrompt;
        actorUserPrompt = userPrompt;
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "action", action: "抬头看向声音传来的方向" }],
        });
      },
    };
    const definition = twoActorWorld();
    definition.directorPolicy = { enabled: false };
    definition.actorMemoryPolicy = { enabled: false };
    definition.relations = [
      {
        fromActorId: "alice",
        toActorId: "bob",
        description: "信任并关注",
      },
      {
        fromActorId: "bob",
        toActorId: "alice",
        description: "对她有所保留",
      },
    ];
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.start();

    world.emitEvent({
      message: "山道上传来一声清晰的呼喊。",
      contextIds: ["chat"],
      actorIds: ["alice"],
    });
    await waitFor(() => actorSystemPrompt.length > 0);

    expect(actorSystemPrompt).toContain("持续运转的世界");
    expect(actorSystemPrompt).toContain("每次 wake 只能使用 perform");
    expect(actorSystemPrompt).not.toContain("你是一个真实群聊中的成员");
    expect(actorUserPrompt).toContain("你对Bob信任并关注");
    expect(actorUserPrompt).not.toContain("Bob对你对她有所保留");
    expect(actorUserPrompt).not.toContain("对她有所保留");
    world.stop();
  });

  it("turns a legacy World silent decision into a visible response", async () => {
    let actorCalls = 0;
    const settlements: unknown[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt }) {
        if (systemPrompt.includes("持续运转的世界")) actorCalls++;
        return JSON.stringify({ type: "silent", reason: "legacy actor output" });
      },
    };
    const definition = twoActorWorld();
    definition.actorMemoryPolicy = { enabled: false };
    definition.contexts[0]!.runtime = { pacingMultiplier: 0.1 };
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.onNotification((notification) => {
      if (notification.type === "actor.wake_settled") {
        settlements.push(notification.payload.outcome);
      }
    });
    world.start();
    world.emitEvent({
      message: "山道上的信号突然中断。",
      contextIds: ["chat"],
      actorIds: ["alice"],
    });

    await waitFor(() => actorCalls >= 2);

    expect(actorCalls).toBe(2);
    expect(world.snapshot().contextSessions[0]?.snapshot.scheduledMessages).toEqual([
      expect.objectContaining({
        speaker: "Alice",
        message: "我还在想刚才那件事。",
        outputKind: "message",
      }),
    ]);
    expect(settlements).not.toContain("silent");
    world.stop();
  });

  it("rejects Director commands when the World policy disables Director", () => {
    const definition = humanOnlyWorld();
    definition.directorPolicy = { enabled: false };
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(definition);
    world.start();

    expect(() => world.requestProgression({ contextId: "chat" }))
      .toThrow("World Director is disabled.");
    expect(world.snapshot().events.some((event) => (
      event.type === "world.progression.requested"
    ))).toBe(false);
    world.stop();
  });

  it("updates one Context pacing without rebuilding or reordering its Session", () => {
    const definition = humanOnlyWorld();
    definition.contexts[0]!.runtime = { pacingMultiplier: 0 };
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(definition);
    const notifications: string[] = [];
    world.onNotification((notification) => notifications.push(notification.type));

    expect(world.getContextPacingMultiplier("chat")).toBe(0);
    expect(world.setContextPacingMultiplier("chat", 1.75)).toBe(1.75);
    expect(world.getContextPacingMultiplier("chat")).toBe(1.75);
    expect(notifications).toContain("context.pacing_changed");
    expect(world.setContextPacingMultiplier("chat", 0)).toBe(0);
    expect(world.getContextPacingMultiplier("chat")).toBe(0);
    expect(world.setContextPacingMultiplier("chat", 99)).toBe(20);
    world.stop();
  });

  it("keeps configured Context pacing stable while presentation mode changes", () => {
    const definition = humanOnlyWorld();
    definition.contexts[0]!.runtime = { pacingMultiplier: 0.8 };
    definition.contexts[0]!.presentation = {
      kind: "galgame",
      playerActorId: "player",
      artDirection: "test",
      backgroundGeneration: "auto",
      acknowledgement: "required",
    };
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(definition);

    expect(world.setContextPresentationMode("chat", "stage")).toBe("stage");
    expect(world.getContextPacingMultiplier("chat")).toBe(0.8);
    const snapshot = world.snapshot();
    const restored = new ChatVerse({ provider: passiveProvider }).createWorld(definition, { snapshot });
    expect(restored.getContextPacingMultiplier("chat")).toBe(0.8);
    expect(restored.snapshot().presentationRuntime?.[0]?.mode).toBe("stage");
    expect(restored.setContextPresentationMode("chat", "world")).toBe("world");
    expect(restored.getContextPacingMultiplier("chat")).toBe(0.8);
    restored.stop();
    expect(world.setContextPresentationMode("chat", "world")).toBe("world");
    expect(world.getContextPacingMultiplier("chat")).toBe(0.8);
    world.stop();
  });

  it("commits context messages in sequence and restores them from a snapshot", async () => {
    const definition = humanOnlyWorld();
    const chatverse = new ChatVerse({ provider: passiveProvider });
    const world = chatverse.createWorld(definition);
    const observed: number[] = [];
    world.onEvent((event) => {
      observed.push(event.sequence);
      if (event.type === "context.message.committed") throw new Error("observer failure");
    });

    world.start();
    world.sendMessage({ contextId: "chat", actorId: "player", message: "hello world" });
    await waitFor(() => world.getContextMessages("chat").length === 1);

    const snapshot = world.snapshot();
    world.stop();
    expect(snapshot.contexts[0]?.scene.text).toBe("quiet\nTesting");
    expect(snapshot.events.filter(
      (event) => event.type === "narrative.narration.committed",
    )).toHaveLength(1);
    expect(snapshot.events.some((event) => event.type === "context.message.committed")).toBe(true);
    expect(observed).toEqual([...observed].sort((left, right) => left - right));

    const restored = chatverse.createWorld(definition, { snapshot });
    expect(restored.getContextMessages("chat")[0]?.message).toBe("hello world");
    const next = restored.emitEvent({ message: "a new condition" });
    expect(next.sequence).toBe(snapshot.eventSequence + 1);
    restored.stop();
  });

  it("restores runtime-created conversation Context definitions from a snapshot", async () => {
    const definition = interactiveWorld();
    const chatverse = new ChatVerse({ provider: passiveProvider });
    const world = chatverse.createWorld(definition);
    const created = world.createChatContext({
      humanActorId: "player",
      actorIds: ["alice"],
      conversationMode: "private",
      topic: "快照恢复测试",
    });
    const snapshot = world.snapshot();

    expect(snapshot.dynamicContexts?.map((context) => context.id)).toEqual([created.id]);
    world.stop();

    const restored = chatverse.createWorld(definition, { snapshot });
    expect(restored.isPrivateConversationContext(created.id)).toBe(true);
    expect(restored.getContextMessages(created.id)).toHaveLength(0);
    restored.sendMessage({
      contextId: created.id,
      actorId: "player",
      message: "恢复后仍然可以继续私聊。",
    });
    await waitFor(() => restored.getContextMessages(created.id).some((message) => (
      message.message === "恢复后仍然可以继续私聊。"
    )));
    restored.stop();
  });

  it("runs a runtime-created Group with autonomous Harness scheduling", () => {
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(interactiveWorld());
    world.start();

    const group = world.createChatContext({
      humanActorId: "player",
      actorIds: ["alice"],
      conversationMode: "group",
      topic: "自主群聊测试",
    });
    const privateChat = world.createChatContext({
      humanActorId: "player",
      actorIds: ["alice"],
      conversationMode: "private",
    });

    expect(group.runtime?.actorRuntime).toMatchObject({
      activation: "autonomous_idle",
      ambient: "off",
    });
    expect(privateChat.runtime?.actorRuntime?.activation).toBe("beat_runtime");
    expect(world.snapshot().contexts.find((context) => context.contextId === group.id)?.status)
      .toBe("active");

    world.pause();
    expect(world.snapshot().contexts.find((context) => context.contextId === group.id)?.status)
      .toBe("active");
    world.stop();
  });

  it("does not append World events or queue input after stop", () => {
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(interactiveWorld());
    world.start();
    world.stop();
    const sequence = world.snapshot().eventSequence;

    expect(() => world.emitEvent({ message: "late event" })).toThrow(/stopped/i);
    expect(() => world.sendMessage({
      contextId: "chat",
      actorId: "player",
      message: "late message",
    })).toThrow(/stopped/i);
    expect(() => world.changeDirection({ contextId: "chat", direction: "late direction" })).toThrow(/stopped/i);
    expect(() => world.setActorPresence({
      actorId: "player",
      presence: "away",
    })).toThrow(/stopped/i);
    expect(world.snapshot().eventSequence).toBe(sequence);
  });

  it("keeps a partial progression trigger pending until a Beat mutation is accepted", async () => {
    let directorCalls = 0;
    const directorThinkingModes: Array<"enabled" | "disabled" | undefined> = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async chat({ thinking }) {
        directorCalls++;
        directorThinkingModes.push(thinking);
        if (directorCalls < 3) return { content: "", toolCalls: [] };
        return {
          content: "",
          toolCalls: [{
            id: "partial-recovery-plan",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "恢复后的第一幕",
                brief: "把开场请求转成一幕可执行的调查。",
                script: testDirectorBeatScript(["alice"]),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const world = new ChatVerse({
      directorProvider: provider,
      characterProvider: passiveProvider,
    }).createWorld(aiWorld(), {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, maxProviderRetries: 2 },
    });
    world.start();
    world.requestProgression({ contextId: "chat", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats.length === 1, 2_000);
    expect(directorCalls).toBeGreaterThanOrEqual(3);
    expect(directorThinkingModes).toEqual(["disabled", "disabled", "disabled"]);
    world.stop();
  });

  it("rejects snapshots that do not use the current schema", () => {
    const definition = humanOnlyWorld();
    const chatverse = new ChatVerse({ provider: passiveProvider });
    const world = chatverse.createWorld(definition);
    const snapshot = world.snapshot();
    world.stop();

    const unsupported = {
      ...snapshot,
      schemaVersion: 3,
    } as unknown as WorldSnapshot;

    expect(() => chatverse.createWorld(definition, { snapshot: unsupported }))
      .toThrow("Unsupported World snapshot schema: 3");
  });

  it("keeps Session digests and chat tails out of the幕-level Director prompt", async () => {
    const seed = new ChatVerse({ provider: passiveProvider }).createWorld(humanOnlyWorld());
    seed.start();
    seed.sendMessage({ contextId: "chat", actorId: "player", message: "The lantern is still burning." });
    seed.sendMessage({ contextId: "chat", actorId: "player", message: "I will wait by the old bridge." });
    await waitFor(() => seed.getContextMessages("chat").length === 2);
    const snapshot = seed.snapshot();
    seed.stop();

    const firstMessageId = snapshot.contextSessions[0]?.snapshot.messages[0]?.id;
    expect(firstMessageId).toBeTruthy();
    snapshot.contextSessions[0]!.snapshot.conversationDigest = {
      summary: "The player is waiting at the old bridge after securing the lantern.",
      recentFacts: ["The bridge is the current meeting point."],
      throughMessageId: firstMessageId,
    };
    snapshot.directorCursor = snapshot.eventSequence;

    let directorPrompt = "";
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat({ messages }) {
        if (!directorPrompt) {
          directorPrompt = messages.find((message) => message.role === "user")?.content ?? "";
        }
        return {
          content: "",
          toolCalls: [
            {
              id: "advance-continuity",
              type: "function",
              function: { name: "advance_world_time", arguments: JSON.stringify({ seconds: 1, reason: "continuity test" }) },
            },
            {
              id: "finish-continuity",
              type: "function",
              function: { name: "finish", arguments: "{}" },
            },
          ],
        };
      },
    };
    const world = new ChatVerse({
      directorProvider,
      characterProvider: passiveProvider,
    }).createWorld(humanOnlyWorld(), {
      snapshot,
      directorPolicy: { enabled: true, minIntervalMs: 0, debounceMs: 0 },
    });
    world.start();
    world.requestProgression({ contextId: "chat", reason: "observer_continue" });
    await waitFor(() => directorPrompt.length > 0);
    world.stop();

    expect(directorPrompt).not.toContain("[Context continuity]");
    expect(directorPrompt).not.toContain("The player is waiting at the old bridge");
    expect(directorPrompt).not.toContain("I will wait by the old bridge.");
    expect(directorPrompt).not.toContain("The lantern is still burning.");
  });

  it("discards an in-flight character result after the actor goes offline", async () => {
    let resolveDecision: ((value: string) => void) | undefined;
    const provider: ChatProvider = {
      ...passiveProvider,
      complete({ systemPrompt }) {
        if (systemPrompt.includes("private long-term memory")) {
          return Promise.resolve(JSON.stringify({ operations: [] }));
        }
        return new Promise<string>((resolve) => {
          resolveDecision = resolve;
        });
      },
    };
    const definition = aiWorld();
    definition.directorPolicy = { enabled: false };
    definition.actorMemoryPolicy = { enabled: false };
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.start();
    world.emitEvent({
      message: "A signal calls for Alice.",
      contextIds: ["chat"],
      actorIds: ["alice"],
    });
    await waitFor(() => Boolean(resolveDecision));
    world.setActorPresence({
      actorId: "alice",
      presence: "offline",
    });
    resolveDecision?.(JSON.stringify({
      type: "perform",
      items: [{ kind: "message", message: "This stale reply must not be committed." }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(world.getContextMessages("chat")).toEqual([]);
    expect(world.getActorState("alice")?.presence).toBe("offline");
    world.stop();
  });

  it("omits offline Actors from the Narrator cast and wakeable targets", () => {
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(twoActorWorld());
    world.setActorPresence({ actorId: "alice", presence: "offline" });
    const beat: NarrativeBeat = {
      id: "beat-offline-cast",
      chapterId: "chapter-main",
      title: "当前一幕",
      brief: "检查在场角色。",
      script: {
        time: "当前",
        location: "测试 Context",
        cast: [{ actorId: "bob", roleInScene: "确认可调度名单" }],
        cause: "角色状态需要核对。",
        development: ["读取角色状态。", "排除离线角色。", "确认可调度名单。"],
        turningPoint: "离线角色被排除。",
        result: "可调度名单已确认。",
        causalChain: ["状态核对开始。", "离线角色被排除。", "名单得到确认。"],
      },
      completesChapter: false,
      minimumActorTurns: 1,
      maximumActorTurns: 4,
      status: "running",
      actorIds: ["alice", "bob"],
      contextIds: ["chat"],
      sourceEventIds: [],
      occurredAt: 0,
    };
    const view = (world as unknown as {
      buildNarratorView: (
        contextId: string,
        beat: NarrativeBeat,
        sourceEventIds: readonly string[],
      ) => { cast: string; availableActorIds: string[] };
    }).buildNarratorView("chat", beat, []);

    expect(view.cast).not.toContain("alice");
    expect(view.cast).toContain("Bob");
    expect(view.availableActorIds).not.toContain("alice");
    expect(view.availableActorIds).toContain("bob");
    world.stop();
  });

  it("keeps the current Narrator trigger out of the earlier timeline", async () => {
    const definition = interactiveWorld();
    definition.directorPolicy = { enabled: false };
    definition.actorMemoryPolicy = { enabled: false };
    definition.contexts[0]!.runtime = {
      ...definition.contexts[0]!.runtime,
      actorRuntime: { activation: "autonomous_idle", ambient: "off" },
    };
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(definition);
    world.start();
    world.sendMessage({ contextId: "chat", actorId: "player", message: "较早的钟声已经停止。" });
    await waitFor(() => world.getContextMessages("chat").length === 1);
    world.sendMessage({ contextId: "chat", actorId: "player", message: "当前窗户突然碎裂。" });
    await waitFor(() => world.getContextMessages("chat").length === 2);
    const playerEvents = world.snapshot().events.filter((event) => (
      event.type === "context.message.committed" && event.actorId === "player"
    ));
    const earlier = playerEvents[0]!;
    const current = playerEvents[1]!;
    const beat: NarrativeBeat = {
      id: "beat-trigger-projection",
      chapterId: "chapter-main",
      title: "当前一幕",
      brief: "处理窗户碎裂。",
      script: {
        time: "当前",
        location: "测试 Context",
        cast: [{ actorId: "alice", roleInScene: "处理破损窗口" }, { actorId: "player", roleInScene: "报告异常" }],
        cause: "窗户突然碎裂。",
        development: ["窗户碎裂。", "现场确认危险。", "有人处理破损。"],
        turningPoint: "破损引发立即行动。",
        result: "碎裂窗户已被处理。",
        causalChain: ["碎裂造成危险。", "报告引发行动。", "行动消除危险。"],
      },
      completesChapter: false,
      minimumActorTurns: 1,
      maximumActorTurns: 4,
      status: "running",
      actorIds: ["alice", "player"],
      contextIds: ["chat"],
      sourceEventIds: [current.id],
      occurredAt: 0,
    };
    const view = (world as unknown as {
      buildNarratorView: (
        contextId: string,
        beat: NarrativeBeat,
        sourceEventIds: readonly string[],
      ) => { timeline: string; triggerEvents: string };
    }).buildNarratorView("chat", beat, [current.id]);

    expect(view.timeline).toContain("较早的钟声已经停止");
    expect(view.timeline).not.toContain("当前窗户突然碎裂");
    expect(view.triggerEvents).toContain("当前窗户突然碎裂");
    expect(view.triggerEvents).not.toContain("较早的钟声已经停止");
    expect(view.triggerEvents).toContain("E1 context.message.committed");
    expect(view.triggerEvents).not.toContain(current.id);
    expect(view.triggerEvents).not.toContain("source=actor:");
    expect(view.triggerEvents).not.toContain("actorId=");
    expect(earlier.sequence).toBeLessThan(current.sequence);
    world.stop();
  });

  it("does not run the macro director in an empty world", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        calls++;
        return { content: "", toolCalls: [] };
      },
    };
    const world = new ChatVerse({ provider }).createWorld(humanOnlyWorld(), {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0 },
    });
    world.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    world.stop();
    expect(calls).toBe(0);
  });

  it("keeps global presence shared while context participation stays local", () => {
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(sharedActorWorld());
    const contexts = (world as unknown as {
      contextRuntimes: Map<string, { session: Session }>;
    }).contextRuntimes;
    const first = contexts.get("first")!.session;
    const second = contexts.get("second")!.session;

    world.setActorPresence({
      actorId: "alice",
      presence: "away",
      status: "巡查中",
    });
    expect(first.getCharacterState("Alice")?.availability).toBe("away");
    expect(second.getCharacterState("Alice")?.availability).toBe("away");

    world.setActorParticipation({
      actorId: "alice",
      contextId: "first",
      participation: "muted",
    });
    expect(first.getCharacterState("Alice")?.availability).toBe("unavailable");
    expect(second.getCharacterState("Alice")?.availability).toBe("away");
    const snapshot = world.snapshot();
    expect(snapshot.actorStates.find((state) => state.actorId === "alice")?.status).toBe("巡查中");
    expect(snapshot.presences.find((presence) => presence.contextId === "first")?.participation).toBe("muted");
    expect(snapshot.presences.find((presence) => presence.contextId === "second")?.participation).toBe("joined");
    world.stop();
  });

  it("registers an Actor at runtime and preserves its membership across snapshots", () => {
    const definition = aiWorld();
    definition.directorPolicy = { enabled: false };
    definition.actorMemoryPolicy = { enabled: false };
    const chatverse = new ChatVerse({ provider: passiveProvider });
    const world = chatverse.createWorld(definition);

    const registered = world.registerActor({
      actor: {
        id: "bob",
        kind: "character",
        card: {
          name: "Bob",
          description: "A late arrival",
          personality: "careful",
          scenario: "",
          messageExample: "",
        },
      },
      relations: [{
        fromActorId: "bob",
        toActorId: "alice",
        description: "trusts",
      }],
    });
    expect(registered.type).toBe("actor.registered");
    expect(registered.payload).not.toHaveProperty("card");
    const relationEvents = world.snapshot().events.filter(
      (event) => event.type === "relation.added",
    );
    expect(relationEvents).toHaveLength(1);
    expect(relationEvents[0]).toMatchObject({
      type: "relation.added",
      causationId: registered.id,
      payload: {
        relation: {
          fromActorId: "bob",
          toActorId: "alice",
          description: "trusts",
        },
      },
    });

    world.setActorParticipation({
      actorId: "bob",
      contextId: "chat",
      participation: "joined",
    });
    const runtimes = (world as unknown as {
      contextRuntimes: Map<string, { session: Session }>;
    }).contextRuntimes;
    expect(runtimes.get("chat")?.session.getCharacterState("Bob")).toBeDefined();

    world.setActorParticipation({
      actorId: "bob",
      contextId: "chat",
      participation: "left",
    });
    expect(runtimes.get("chat")?.session.getCharacterState("Bob")).toBeUndefined();

    const snapshot = world.snapshot();
    expect(snapshot.schemaVersion).toBe(7);
    expect(snapshot.dynamicActors.map((actor) => actor.id)).toEqual(["bob"]);
    expect(snapshot.dynamicRelations).toEqual([{
      fromActorId: "bob",
      toActorId: "alice",
      description: "trusts",
    }]);
    world.stop();

    const restored = chatverse.createWorld(definition, { snapshot });
    expect(restored.getActorState("bob")).toBeDefined();
    expect(restored.snapshot().presences.find(
      (presence) => presence.actorId === "bob" && presence.contextId === "chat",
    )?.participation).toBe("left");
    restored.setActorParticipation({
      actorId: "bob",
      contextId: "chat",
      participation: "joined",
    });
    expect(restored.snapshot().presences.find(
      (presence) => presence.actorId === "bob" && presence.contextId === "chat",
    )?.participation).toBe("joined");
    restored.stop();
  });

  it("does not disclose pre-entry chat history to a newly joined Actor", async () => {
    const prompts: string[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt, userPrompt }) {
        if (systemPrompt.includes("持续运转的世界")) prompts.push(userPrompt);
        return JSON.stringify({ type: "silent", reason: "observing" });
      },
    };
    const definition = humanOnlyWorld();
    definition.actorMemoryPolicy = { enabled: false };
    definition.contexts[0]!.runtime = { pacingMultiplier: 0 };
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.start();
    world.sendMessage({
      contextId: "chat",
      actorId: "player",
      message: "secret before entry",
    });
    await waitFor(() => world.getContextMessages("chat").length === 1);

    world.registerActor({
      actor: {
        id: "bob",
        kind: "character",
        card: {
          name: "Bob",
          description: "A newcomer",
          personality: "observant",
          scenario: "",
          messageExample: "",
        },
      },
    });
    world.setActorParticipation({
      actorId: "bob",
      contextId: "chat",
      participation: "joined",
    });
    await waitFor(() => prompts.length > 0);
    expect(prompts.at(-1)).not.toContain("secret before entry");

    prompts.length = 0;
    world.sendMessage({
      contextId: "chat",
      actorId: "player",
      message: "@Bob visible after entry",
    });
    await waitFor(() => prompts.length > 0);
    expect(prompts.at(-1)).toContain("visible after entry");
    expect(prompts.at(-1)).not.toContain("secret before entry");
    world.stop();
  });

  it("discards an in-flight result when a dynamically joined Actor leaves", async () => {
    let resolveDecision: ((value: string) => void) | undefined;
    const provider: ChatProvider = {
      ...passiveProvider,
      complete() {
        return new Promise<string>((resolve) => {
          resolveDecision = resolve;
        });
      },
    };
    const definition = humanOnlyWorld();
    definition.actorMemoryPolicy = { enabled: false };
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.registerActor({
      actor: {
        id: "bob",
        kind: "character",
        card: {
          name: "Bob",
          description: "A temporary visitor",
          personality: "brief",
          scenario: "",
          messageExample: "",
        },
      },
    });
    world.setActorParticipation({
      actorId: "bob",
      contextId: "chat",
      participation: "joined",
    });
    world.start();
    await waitFor(() => Boolean(resolveDecision));

    world.setActorParticipation({
      actorId: "bob",
      contextId: "chat",
      participation: "left",
    });
    resolveDecision?.(JSON.stringify({
      type: "perform",
      items: [{ kind: "message", message: "This reply must be discarded." }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(world.getContextMessages("chat")).toEqual([]);
    world.stop();
  });

  it("lets an autonomous Actor leave through a committed self action", () => {
    const definition = aiWorld();
    definition.directorPolicy = { enabled: false };
    definition.actorMemoryPolicy = { enabled: false };
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(definition);
    const internal = world as unknown as {
      commitContextActorAction(
        contextId: string,
        actorId: string,
        action: {
          id: string;
          characterName: string;
          action: string;
          contextTransition: "leave";
          timestamp: number;
        },
      ): void;
    };

    internal.commitContextActorAction("chat", "alice", {
      id: "leave-action",
      characterName: "Alice",
      action: "Alice closes the door and leaves.",
      contextTransition: "leave",
      timestamp: Date.now(),
    });

    const snapshot = world.snapshot();
    expect(snapshot.presences.find(
      (presence) => presence.actorId === "alice" && presence.contextId === "chat",
    )?.participation).toBe("left");
    const actionEvent = snapshot.events.find((event) => event.type === "context.action.committed");
    const leaveEvent = snapshot.events.find((event) => event.type === "actor.participation.changed");
    expect(leaveEvent?.causationId).toBe(actionEvent?.id);
    world.stop();
  });

  it("keeps actor memories private to the actor and restores their runtime overlay", () => {
    const definition = sharedActorWorld();
    const alice = definition.actors.find((actor) => actor.id === "alice");
    if (!alice || alice.kind !== "character") throw new Error("Missing Alice actor");
    alice.memory = {
      nodes: [{
        id: "seed",
        kind: "self",
        semanticKey: "self:bridge-promise",
        title: "A standing promise",
        content: "Alice promised to protect the bridge.",
        importance: 0.9,
      }],
    };
    const chatverse = new ChatVerse({ provider: passiveProvider });
    const world = chatverse.createWorld(definition);
    const event = world.emitEvent({ message: "The bridge shook again.", actorIds: ["alice"] });
    const recorded = world.recordActorMemory({
      actorId: "alice",
      candidate: {
        kind: "belief",
        semanticKey: "belief:bridge-instability",
        title: "Bridge instability",
        content: "Alice now suspects the bridge is becoming unsafe.",
        sourceEventIds: [event.id],
      },
    });

    expect(world.recallActorMemory("alice", { query: "bridge" }).entries.map((entry) => entry.node.id))
      .toContain(recorded.id);
    expect(() => world.recordActorMemory({
      actorId: "alice",
      candidate: { kind: "belief", semanticKey: "belief:bad-source", title: "Bad source", content: "No provenance.", sourceEventIds: ["missing"] },
    })).toThrow("source event does not exist");

    const snapshot = world.snapshot();
    world.stop();
    const restored = chatverse.createWorld(definition, { snapshot });
    expect(restored.getActorMemorySnapshot("alice").nodes.map((node) => node.id)).toContain(recorded.id);
    expect(snapshot.events.some((item) => item.type === "actor.memory.recorded")).toBe(true);
    restored.stop();
  });

  it("suspends an inactive context without discarding its state", async () => {
    const runtime = new ManualRuntimeHost(1_000);
    const definition = humanOnlyWorld();
    definition.directorPolicy = { enabled: false, contextSuspendAfterMs: 10_000 };
    const world = new ChatVerse({ provider: passiveProvider, runtime }).createWorld(definition);
    world.start();
    await Promise.resolve();
    runtime.advanceBy(10_000);
    await Promise.resolve();

    expect(world.snapshot().contexts.find((context) => context.contextId === "chat")?.status).toBe("dormant");
    world.stop();
  });

  it("reactivates a dormant context when the observer requests progression", async () => {
    const runtime = new ManualRuntimeHost(1_000);
    const definition = interactiveWorld();
    definition.directorPolicy = {
      enabled: true,
      contextSuspendAfterMs: 10_000,
      minIntervalMs: 0,
      debounceMs: 0,
    };
    definition.actorMemoryPolicy = { enabled: false };
    const world = new ChatVerse({ provider: passiveProvider, runtime }).createWorld(definition);

    world.start();
    await Promise.resolve();
    runtime.advanceBy(10_000);
    await Promise.resolve();
    expect(world.snapshot().contexts[0]?.status).toBe("dormant");

    world.requestProgression({ contextId: "chat" });

    expect(world.snapshot().contexts[0]?.status).toBe("active");
    expect(world.debugSnapshot().contexts[0]?.session.status).toBe("running");
    world.stop();
  });

  it("re-arms a persisted ambient wake after restoring a dormant context", async () => {
    let directorCalls = 0;
    const provider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        directorCalls++;
        return {
          content: "",
          toolCalls: [{
            id: `finish-${directorCalls}`,
            type: "function",
            function: { name: "finish", arguments: "{}" },
          }],
        };
      },
    };
    const runtime = new ManualRuntimeHost(1_000);
    const definition = interactiveWorld();
    definition.directorPolicy = {
      enabled: true,
      contextSuspendAfterMs: 10_000,
      minIntervalMs: 0,
      debounceMs: 0,
    };
    definition.actorMemoryPolicy = { enabled: false };
    const world = new ChatVerse({ provider, runtime }).createWorld(definition);

    world.start();
    await Promise.resolve();
    const firstDue = world.snapshot().contexts[0]?.activity?.nextAmbientAt;
    expect(firstDue).toBeDefined();
    runtime.advanceBy(10_000);
    await Promise.resolve();
    const snapshot = world.snapshot();
    expect(snapshot.contexts[0]?.status).toBe("dormant");
    const persistedDue = snapshot.contexts[0]?.activity?.nextAmbientAt;
    expect(persistedDue).toBe(firstDue);
    world.stop();

    const restored = new ChatVerse({ provider, runtime }).createWorld(definition, { snapshot });
    restored.start();
    expect(restored.snapshot().contexts[0]?.activity?.nextAmbientAt).toBe(persistedDue);

    runtime.advanceTo(persistedDue!);
    await waitFor(() => directorCalls === 1);
    restored.stop();
  });

  it("curates observable events into one idempotent Actor memory patch", async () => {
    let curatorCalls = 0;
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt, userPrompt }) {
        if (!systemPrompt.includes("private long-term memory")) {
          return JSON.stringify({ type: "silent", reason: "test" });
        }
        curatorCalls++;
        const sourceEventId = userPrompt.match(
          /-\s+\[\d+\]\s+(\S+)\s+world\.event\.emitted/,
        )?.[1] ?? "";
        return JSON.stringify({
          actorUpdates: [{ actorId: "alice", operations: [{
            type: "create",
            kind: "belief",
            semanticKey: "belief:bridge-change",
            title: "The bridge is changing",
            content: "Alice believes the bridge now needs close attention.",
            importance: 0.8,
            confidence: 0.7,
            sourceEventIds: [sourceEventId],
            links: [{
              toId: "chapter:bridge",
              type: "continues",
              weight: 0.8,
            }],
          }] }],
        });
      },
    };
    const definition = aiWorld();
    definition.directorPolicy = { enabled: false };
    definition.actorMemoryPolicy = {
      enabled: true,
      maxEvidenceEvents: 10,
      boundaryDebounceMs: 0,
    };
    const chatverse = new ChatVerse({ provider });
    const world = chatverse.createWorld(definition);
    world.start();
    world.emitEvent({ message: "The bridge shifted.", actorIds: ["alice"] });
    world.emitEvent({ message: "A second crack appeared.", actorIds: ["alice"] });
    consolidateActorMemory(world, ["alice"]);
    await waitFor(() => world.getActorMemorySnapshot("alice").nodes.length === 1);

    const snapshot = world.snapshot();
    world.stop();
    expect(curatorCalls).toBe(1);
    expect(snapshot.actorMemoryRuntime[0]?.pendingEventIds).toEqual([]);
    expect(snapshot.events.filter((event) => event.type === "actor.memory.updated")).toHaveLength(1);
    expect(snapshot.actorMemories[0]?.nodes[0]?.sourceEventIds).toHaveLength(1);

    const restored = chatverse.createWorld(definition, { snapshot });
    restored.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    restored.stop();
    expect(curatorCalls).toBe(1);
  });

  it("keeps observations private to explicitly targeted Actors", async () => {
    const curatedActors: string[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt, userPrompt }) {
        if (!systemPrompt.includes("private long-term memory")) {
          return JSON.stringify({ type: "silent", reason: "test" });
        }
        const actorId = userPrompt.match(/id=(\S+)/)?.[1] ?? "";
        curatedActors.push(actorId);
        return JSON.stringify({ actorUpdates: [{ actorId, operations: [] }] });
      },
    };
    const definition = twoActorWorld();
    definition.actorMemoryPolicy = {
      enabled: true,
      boundaryDebounceMs: 0,
    };
    const world = new ChatVerse({ provider }).createWorld(definition, { debug: true });
    expect(world.debugSnapshot().memory.map(
      (entry) => entry.runtime.candidateEventCount,
    )).toEqual([0, 0]);
    world.start();
    world.emitEvent({ message: "Alice alone sees the signal.", actorIds: ["alice"] });
    consolidateActorMemory(world, ["alice"]);
    await waitFor(() => curatedActors.length === 1);
    world.stop();

    expect(curatedActors).toEqual(["alice"]);
  });

  it("curates multiple focus Actors in one shared call but commits isolated memories", async () => {
    let curatorCalls = 0;
    const curatorThinkingModes: Array<"enabled" | "disabled" | undefined> = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt, userPrompt, thinking }) {
        if (!systemPrompt.includes("private long-term memory")) {
          return JSON.stringify({ type: "silent", reason: "test" });
        }
        curatorCalls++;
        curatorThinkingModes.push(thinking);
        const sourceEventId = userPrompt.match(
          /-\s+\[\d+\]\s+(\S+)\s+world\.event\.emitted/,
        )?.[1] ?? "";
        return JSON.stringify({
          actorUpdates: [
            {
              actorId: "alice",
              operations: [{
                type: "create",
                kind: "relation",
                semanticKey: "relation:bob",
                title: "Bob noticed the same signal",
                content: "Alice remembers that Bob witnessed the signal with her.",
                sourceEventIds: [sourceEventId],
                links: [{ toId: "actor:bob", type: "trusts", weight: 0.6 }],
              }],
            },
            {
              actorId: "bob",
              operations: [{
                type: "create",
                kind: "relation",
                semanticKey: "relation:alice",
                title: "Alice noticed the signal",
                content: "Bob remembers that Alice witnessed the signal with him.",
                sourceEventIds: [sourceEventId],
                links: [{ toId: "actor:alice", type: "trusts", weight: 0.6 }],
              }],
            },
          ],
        });
      },
    };
    const definition = twoActorWorld();
    definition.actorMemoryPolicy = {
      enabled: true,
      boundaryDebounceMs: 0,
    };
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.start();
    world.emitEvent({
      message: "Alice and Bob both see the signal.",
      contextIds: ["chat"],
    });
    consolidateActorMemory(world, ["alice", "bob"]);
    await waitFor(() => (
      world.getActorMemorySnapshot("alice").nodes.length === 1 &&
      world.getActorMemorySnapshot("bob").nodes.length === 1
    ));
    world.stop();

    expect(curatorCalls).toBe(1);
    expect(curatorThinkingModes).toEqual(["enabled"]);
    expect(world.getActorMemorySnapshot("alice").nodes[0]?.content).toContain("Bob");
    expect(world.getActorMemorySnapshot("bob").nodes[0]?.content).toContain("Alice");
    expect(world.snapshot().events.filter(
      (event) => event.type === "actor.memory.updated",
    )).toHaveLength(2);
    expect(world.snapshot().dynamicRelations).toEqual(expect.arrayContaining([
      {
        fromActorId: "alice",
        toActorId: "bob",
        description: "Alice remembers that Bob witnessed the signal with her.",
      },
      {
        fromActorId: "bob",
        toActorId: "alice",
        description: "Bob remembers that Alice witnessed the signal with him.",
      },
    ]));
    expect(world.snapshot().events.filter(
      (event) => event.type === "relation.updated",
    )).toHaveLength(2);
  });

  it("does not let automatic curation grow beyond the per-Actor memory cap", async () => {
    let curatorCalls = 0;
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ systemPrompt, userPrompt }) {
        if (!systemPrompt.includes("private long-term memory")) {
          return JSON.stringify({ type: "silent", reason: "test" });
        }
        curatorCalls++;
        const sourceEventId = userPrompt.match(
          /-\s+\[\d+\]\s+(\S+)\s+world\.event\.emitted/,
        )?.[1] ?? "";
        return JSON.stringify({
          actorUpdates: [{
            actorId: "alice",
            operations: [{
              type: "create",
              kind: "episode",
              semanticKey: "episode:one-more-note",
              title: "One more note",
              content: "This note must be rejected at capacity.",
              sourceEventIds: [sourceEventId],
            }],
          }],
        });
      },
    };
    const definition = aiWorld();
    const actor = definition.actors.find((candidate) => candidate.id === "alice");
    if (!actor) throw new Error("Missing Alice fixture.");
    actor.memory = {
      nodes: Array.from({ length: 8 }, (_, index) => ({
        id: `seed-${index}`,
        kind: "episode" as const,
        semanticKey: `episode:seed-${index}`,
        title: `Seed ${index}`,
        content: `Durable seed memory ${index}`,
      })),
    };
    definition.directorPolicy = { enabled: false };
    definition.actorMemoryPolicy = {
      enabled: true,
      maxNotesPerActor: 8,
      boundaryDebounceMs: 0,
    };
    const world = new ChatVerse({ provider }).createWorld(definition);
    world.start();
    world.emitEvent({ message: "A new event arrives.", actorIds: ["alice"] });
    consolidateActorMemory(world, ["alice"]);
    await waitFor(() => curatorCalls === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    world.stop();

    expect(world.getActorMemorySnapshot("alice").nodes).toHaveLength(8);
  });

  it("keeps an updated player card in the runtime Actor registry", () => {
    const definition = humanOnlyWorld();
    const world = new ChatVerse({ provider: passiveProvider }).createWorld(definition);

    world.updatePlayerCard({
      actorId: "player",
      card: {
        name: "新玩家",
        identity: "山口旅人",
        background: "刚刚抵达山口。",
        personality: "谨慎",
        appearance: "背着行囊。",
        speechStyle: "简洁直接。",
        boundaries: "不替其他角色作决定。",
      },
    });

    expect(world.getRegisteredActors()).toEqual([
      expect.objectContaining({
        id: "player",
        kind: "character",
        playerControlled: true,
        card: expect.objectContaining({ name: "新玩家", description: "山口旅人。刚刚抵达山口。" }),
        playerCard: expect.objectContaining({ name: "新玩家" }),
      }),
    ]);
    world.stop();
  });
});


  it("keeps scene planning out of the Director tool catalog", () => {
    const tools = worldDirectorTools("manage");
    const names = tools.map((tool) => tool.function.name);
    expect(names).not.toContain("plan_beat");
    expect(names).not.toContain("spawn_actor");
    expect(names).not.toContain("narrate");
    expect(names).not.toContain("request_actor_wake");
    expect(names).not.toContain("speak");
  });

  it("plans one Beat, lets the Narrator open it, and keeps Actor output away from the Director", async () => {
    let directorCalls = 0;
    let directorMaxTokens: number | undefined;
    let directorReasoningEffort: string | undefined;
    let narratorCalls = 0;
    const narratorPrompts: string[] = [];
    const narratorProvider: ChatProvider = {
      ...passiveProvider,
      profile: {
        compatibility: { supportsThinkingDisable: false, supportsReasoningEffort: true },
        maxOutputTokens: 32_768,
      } as ChatProvider["profile"],
      async complete({ userPrompt, requestContext }) {
        if (requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          narratorPrompts.push(userPrompt);
        }
        return requestContext?.purpose === "world_narrator"
          ? JSON.stringify({
              narration: userPrompt.includes("open_beat") ? "暮色落在山口，前路传来碎石滚动声。" : null,
              sceneNow: "暮色中的山口，碎石声来自前路。",
              wakes: [{ actorId: "行人", urgency: "relevant", guidance: "确认前路碎石声的来源。", requiresResponse: false }],
              playerTurn: null,
              directorRequest: null,
              beatStatus: "continue",
              outcome: null,
            })
          : JSON.stringify({
              type: "perform",
              items: [
                { kind: "action", action: "抬头看向碎石滚动的方向" },
                { kind: "message", message: "前面的动静不像是风吹出来的。" },
              ],
            });
      },
      async chat({ maxTokens, reasoningEffort }) {
        directorCalls++;
        directorMaxTokens = maxTokens;
        directorReasoningEffort = reasoningEffort;
        return {
          content: "",
          toolCalls: [{
            id: "plan-1",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "山口异响",
                brief: "行人抵达山口，并确认异响来自何处。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const definition = beatWorld();
    definition.contexts[0]!.presentation = {
      kind: "galgame",
      playerActorId: "human",
      artDirection: "测试舞台",
      backgroundGeneration: "auto",
      acknowledgement: "required",
    };
    const world = new ChatVerse({
      directorProvider: narratorProvider,
      characterProvider: narratorProvider,
    }).createWorld(definition);
    world.start();
    world.setContextPresentationMode("context-main", "stage");
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats.length === 1);
    await waitFor(() => world.snapshot().events.some(
      (event) => event.type === "narrative.narration.committed" &&
        event.payload.narration.text.includes("山口"),
    ));
    await waitFor(() => world.snapshot().events.some(
      (event) => event.type === "context.action.committed" &&
        event.payload.action.action.includes("碎石"),
    ));
    await waitFor(() => world.snapshot().events.some(
      (event) => event.type === "context.message.committed" &&
        event.payload.message.message.includes("风吹"),
    ));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const presentation = world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-main",
    );
    const actorEntryIds = world.snapshot().events
      .filter((event) => (
        event.type === "context.action.committed" ||
        event.type === "context.message.committed"
      ))
      .map((event) => event.id);
    expect(presentation?.buffered[0]?.entryIds).toEqual(actorEntryIds);
    const actorTurnEvents = world.snapshot().events.filter((event) => (
      event.type === "context.action.committed" ||
      event.type === "context.message.committed"
    ));
    const actorTurnCorrelationIds = new Set(actorTurnEvents.map((event) => event.correlationId));
    expect(actorTurnCorrelationIds.size).toBe(1);
    expect([...actorTurnCorrelationIds][0]).toEqual(expect.any(String));

    const beat = world.snapshot().narrative.beats[0]!;
    expect(beat).toMatchObject({
      title: "山口异响",
      brief: "行人抵达山口，并确认异响来自何处。",
      script: testBeatScript(),
      status: "running",
    });
    expect(directorCalls).toBe(1);
    expect(directorMaxTokens).toBe(16_000);
    expect(directorReasoningEffort).toBe("minimal");
    expect(narratorCalls).toBe(1);

    const openingTurn = presentation?.current;
    expect(openingTurn?.participant).toEqual({ type: "narration" });
    expect(world.acknowledgePresentation({
      contextId: "context-main",
      turnToken: openingTurn!.turnToken,
    })).toBe("accepted");
    const actorTurn = world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-main",
    )?.current;
    expect(actorTurn?.participant).toEqual({ type: "actor", actorId: "actor-a" });
    expect(world.acknowledgePresentation({
      contextId: "context-main",
      turnToken: actorTurn!.turnToken,
    })).toBe("accepted");
    await waitFor(() => narratorCalls === 2);
    const secondTriggerBlock = narratorPrompts[1]
      ?.split("[Current trigger events]\n")[1]
      ?.split("\n\n")[0] ?? "";
    expect(secondTriggerBlock).toContain("context.message.committed");
    expect(secondTriggerBlock).toContain("context.action.committed");
    expect(secondTriggerBlock).not.toContain("narrative.narration.committed");
    expect(narratorPrompts[1]).toContain("actorTurns=1");
    await waitFor(() => world.snapshot().events.filter(
      (event) => event.type === "context.message.committed",
    ).length >= 2);
    expect(world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-main",
    )?.current?.participant).toEqual({ type: "actor", actorId: "actor-a" });

    const internal = world as unknown as {
      commitContextActorAction(
        contextId: string,
        actorId: string,
        action: {
          id: string;
          characterName: string;
          action: string;
          timestamp: number;
        },
      ): void;
    };
    internal.commitContextActorAction("context-main", "actor-a", {
      id: "ordinary-action",
      characterName: "行人",
      action: "抬手挡住迎面的风",
      timestamp: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(narratorCalls).toBe(2);
    world.stop();
  });

  it("surfaces a failed Narrator turn and lets the player retry the same responsibility", async () => {
    let narratorErrors = 0;
    let narratorCalls = 0;
    let allowRecovery = false;
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext }) {
        if (requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          if (allowRecovery) {
            return JSON.stringify({
              narration: null,
              sceneNow: "山口传来清晰的碎石滚落声。",
              wakes: [{
                actorId: "行人",
                urgency: "relevant",
                guidance: "直接确认山口异响的来源。",
                requiresResponse: false,
              }],
              playerTurn: null,
              directorRequest: null,
              beatStatus: "continue",
              outcome: null,
            });
          }
          return JSON.stringify({
            narration: null,
            sceneNow: "山口仍然安静。",
            wakes: [],
            playerTurn: null,
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "我先去确认山口的动静。" }],
        });
      },
      async chat() {
        return {
          content: "",
          toolCalls: [{
            id: "plan-empty-recovery",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "山口异响",
                brief: "行人抵达山口，并确认异响来自何处。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const world = new ChatVerse({
      directorProvider: provider,
      characterProvider: provider,
    }).createWorld(beatWorld());
    world.onNotification((notification) => {
      if (notification.type === "narrator.error") narratorErrors++;
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });

    await waitFor(() => world.getForegroundRecovery("context-main")?.status === "failed");
    const failed = world.getForegroundRecovery("context-main");
    expect(failed).toMatchObject({
      operation: "narrator",
      responsibility: "open_beat",
      status: "failed",
      failure: { kind: "protocol", retryable: true },
    });
    // Automatic attempts are represented by runtime.retry_scheduled. Only the
    // exhausted operation is a terminal Narrator error.
    expect(narratorErrors).toBe(1);
    expect(narratorCalls).toBeGreaterThanOrEqual(4);

    allowRecovery = true;
    expect(world.retryForegroundOperation({
      contextId: "context-main",
      failureId: failed!.failure!.id,
    })).toBe(true);
    await waitFor(() => world.snapshot().events.some(
      (event) => event.type === "context.message.committed" &&
        event.payload.message.message.includes("确认山口"),
    ), 4_000);

    expect(world.getForegroundRecovery("context-main")?.status).not.toBe("failed");
    expect(world.snapshot().narrative.beats[0]?.status).toBe("running");
    world.stop();
  });

  it("routes an active Beat World Event through the Narrator without reopening the Director", async () => {
    let directorCalls = 0;
    let narratorCalls = 0;
    const narratorPrompts: string[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ userPrompt, requestContext }) {
        if (requestContext?.purpose !== "world_narrator") {
          return JSON.stringify({ type: "silent", reason: "no direct response" });
        }
        narratorCalls++;
        narratorPrompts.push(userPrompt);
        const corrected = userPrompt.includes("氧气只剩16分钟");
        return JSON.stringify({
          narration: null,
          sceneNow: corrected
            ? "归潮-7舱内氧气只剩16分钟，旧读数已经失效。舱门仍未开启。"
            : "归潮-7舱门关闭，氧气读数仍待确认。",
          wakes: [{ actorId: "行人", urgency: "relevant", guidance: "回应最新氧气读数。", requiresResponse: false }],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async chat() {
        directorCalls++;
        return {
          content: "",
          toolCalls: [{
            id: `plan-${directorCalls}`,
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "封闭舱室",
                brief: "舱门保持封闭。行人需要确认当前限制并寻找出口。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const world = new ChatVerse({
      directorProvider: provider,
      characterProvider: provider,
    }).createWorld(beatWorld(), {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 10_000 },
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });
    await waitFor(() => world.snapshot().narrative.beats.length === 1);
    await waitFor(() => narratorCalls === 1);

    world.emitEvent({
      message: "最新检测确认归潮-7舱内氧气只剩16分钟，旧读数作废。",
      contextIds: ["context-main"],
    });
    await waitFor(() => narratorCalls === 2);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const snapshot = world.snapshot();
    world.stop();
    expect(directorCalls).toBe(1);
    expect(narratorPrompts[1]).toContain("[Current trigger events]");
    expect(narratorPrompts[1]).toContain("氧气只剩16分钟");
    expect(snapshot.contexts[0]?.scene?.text).toContain("氧气只剩16分钟");
    expect(snapshot.events.filter(
      (event) => event.type === "narrative.beat.completed" && event.payload.reason === "superseded",
    )).toHaveLength(0);

    const restored = new ChatVerse({
      directorProvider: provider,
      characterProvider: provider,
    }).createWorld(beatWorld(), { snapshot });
    expect(restored.snapshot().narrative.beats[0]?.status).toBe("running");
    expect(restored.snapshot().contexts[0]?.scene?.text).toContain("氧气只剩16分钟");
    restored.stop();
  });

  it("starts the Narrator again after pause/resume and snapshot restore", async () => {
    let directorCalls = 0;
    let narratorCalls = 0;
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext }) {
        if (requestContext?.purpose !== "world_narrator") {
          return JSON.stringify({ type: "silent", reason: "not narrator" });
        }
        narratorCalls++;
        return JSON.stringify({
          narration: "山口的暮色压低了声音。",
          sceneNow: "山口仍在暮色中，异响尚未查明。",
          wakes: [],
          playerTurn: null,
          directorRequest: null,
          beatStatus: "continue",
          outcome: null,
        });
      },
      async chat() {
        directorCalls++;
        return {
          content: "",
          toolCalls: [{
            id: `plan-${directorCalls}`,
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "山口异响",
                brief: "确认山口异响的来源。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const chatverse = new ChatVerse({
      directorProvider: provider,
      characterProvider: provider,
    });
    const world = chatverse.createWorld(beatWorld(), {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 0 },
    });
    let narratorCompletions = 0;
    world.onNotification((notification) => {
      if (notification.type === "narrator.completed") narratorCompletions++;
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });
    await waitFor(() => narratorCompletions === 1);
    await waitFor(() => world.snapshot().narrative.beats[0]?.status === "running");

    world.pause();
    world.resume();
    await waitFor(() => narratorCompletions === 2);

    const snapshot = world.snapshot();
    world.stop();
    const restored = chatverse.createWorld(beatWorld(), { snapshot });
    restored.onNotification((notification) => {
      if (notification.type === "narrator.completed") narratorCompletions++;
    });
    restored.start();
    await waitFor(() => narratorCompletions === 3);
    expect(directorCalls).toBe(1);
    expect(narratorCalls).toBe(3);
    restored.stop();
  });

  it("lets Narrator transform a private direction into the new scene without exposing the raw input", async () => {
    let directorCalls = 0;
    const directorPrompts: string[] = [];
    const narratorPrompts: string[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext, userPrompt }) {
        if (requestContext?.purpose === "world_narrator") {
          narratorPrompts.push(userPrompt);
          if (!userPrompt.includes("[Mode]\nredirect_scene")) {
            return JSON.stringify({
              narration: "山口的风声仍在石壁间回旋。",
              sceneNow: "众人仍在山口调查异响。",
              wakes: [],
              playerTurn: null,
              directorRequest: null,
              beatStatus: "continue",
              outcome: null,
            });
          }
          return JSON.stringify({
            narration: "山风转向，众人离开山口，沿着河谷旧路继续前进。",
            sceneNow: "众人已经离开山口，正在河谷旧路上前进。",
            wakes: [{ actorId: "行人", urgency: "relevant", guidance: "承接改道后的河谷局面。", requiresResponse: false }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        return JSON.stringify({ type: "silent", reason: "waiting" });
      },
      async chat({ messages }) {
        directorCalls++;
        const prompt = messages.find((message) => message.role === "user")?.content ?? "";
        directorPrompts.push(prompt);
        return {
          content: "",
          toolCalls: [{
            id: `plan-directive-${directorCalls}`,
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: directorCalls <= 2 ? "原定山路" : "玩家改道",
                brief: directorCalls <= 2
                  ? "行人沿原定山路调查异响。当前压力来自前路未知。"
                  : "玩家要求离开山口，行人需要改走河谷。当前问题是确认新路线。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const definition = beatWorld();
    definition.chapters!.push({
      id: "chapter-river",
      title: "河谷旧路",
      treatment: "队伍离开山口后沿河谷旧路继续调查，必须在沿途痕迹、地形风险和未知来者之间逐步确认新的通行条件。",
      targetOutcome: "队伍确认河谷旧路可安全通行，并决定继续沿河谷前进。",
      status: "queued",
      actorIds: ["actor-a"],
      contextIds: ["context-main"],
      beatIds: [],
    });
    const world = new ChatVerse({
      directorProvider: provider,
      characterProvider: provider,
    }).createWorld(definition, {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 10_000 },
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });
    await waitFor(() => world.snapshot().narrative.beats.length === 1);

    const rawDirection = "别再调查山口了，让所有人改走河谷。";
    world.changeDirection({ contextId: "context-main", direction: rawDirection });
    await waitFor(() => world.snapshot().events.some((event) => (
      event.type === "narrative.narration.committed" &&
      event.payload.narration.text === "山风转向，众人离开山口，沿着河谷旧路继续前进。"
    )));
    const snapshot = world.snapshot();
    world.stop();

    expect(snapshot.narrative.beats.find((beat) => beat.title === "原定山路")?.status)
      .toBe("running");
    expect(snapshot.narrative.beats).toHaveLength(1);
    expect(snapshot.narrative.foregroundChapterId).toBe("chapter-main");
    expect(snapshot.events.filter(
      (event) => event.type === "narrative.chapter.focus_changed",
    ).map((event) => event.payload)).toEqual([
      expect.objectContaining({ toChapterId: "chapter-main", reason: "initial" }),
    ]);
    expect(directorCalls).toBe(1);
    expect(directorPrompts).toHaveLength(1);
    expect(narratorPrompts.at(-1)).toContain("[Mode]\nredirect_scene");
    expect(narratorPrompts.at(-1)).toContain(rawDirection);
    expect(narratorPrompts.at(-1)).toContain("[Authoritative redirect instruction]");
    expect(narratorPrompts.at(-1)).toContain("它不是建议，不需要任何角色同意");
    expect(snapshot.events.some((event) => JSON.stringify(event).includes(rawDirection))).toBe(false);
    expect(snapshot.events.some(
      (event) => event.type === "narrative.beat.completed" && event.payload.reason === "superseded",
    )).toBe(false);
    expect(snapshot.contexts.find((context) => context.contextId === "context-main")?.scene.text)
      .toBe("众人已经离开山口，正在河谷旧路上前进。");
    expect(snapshot.presentationRuntime?.find((runtime) => runtime.contextId === "context-main")?.current)
      .toBeUndefined();
    const restored = new ChatVerse({ provider }).createWorld(definition, { snapshot });
    expect(restored.snapshot().narrative.foregroundChapterId).toBe("chapter-main");
    expect(restored.snapshot().contexts.find((context) => context.contextId === "context-main")?.scene.text)
      .toBe("众人已经离开山口，正在河谷旧路上前进。");
    restored.stop();
  });

  it("sends a World Event without an active Beat to the Director with bounded relevant lore", async () => {
    let directorPrompt = "";
    const provider: ChatProvider = {
      ...passiveProvider,
      async chat({ messages }) {
        directorPrompt = messages.find((message) => message.role === "user")?.content ?? "";
        return {
          content: "",
          toolCalls: [{
            id: "plan-lore",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "氧气警报",
                brief: "舱内氧气进入警戒线。行人需要处理眼前的生存压力。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const definition = beatWorld();
    definition.lore = {
      name: "归潮规程",
      description: "Director 必须遵循的舱室规则。",
      entries: [
        { keys: [], content: "舱门只能从内部机械解锁。", priority: 1, position: "before", constant: true },
        { keys: ["氧气"], content: "氧气警报发生时不得把旧读数当作当前值。", priority: 2, position: "before", constant: false },
        { keys: ["王都"], content: "王都档案馆保存着无关地图。", priority: 3, position: "before", constant: false },
      ],
    };
    const world = new ChatVerse({
      directorProvider: provider,
      characterProvider: passiveProvider,
    }).createWorld(definition, {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0 },
    });
    world.start();
    world.emitEvent({
      message: "氧气警报刚刚响起。",
      contextIds: ["context-main"],
    });
    await waitFor(() => world.snapshot().narrative.beats.length === 1);
    world.stop();

    expect(directorPrompt).toContain("Director 必须遵循的舱室规则");
    expect(directorPrompt).toContain("舱门只能从内部机械解锁");
    expect(directorPrompt).toContain("氧气警报发生时不得把旧读数当作当前值");
    expect(directorPrompt).not.toContain("王都档案馆");
  });

  it("honors the Narrator Actor selection without filling the wake list", async () => {
    const actorCalls: string[] = [];
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext }) {
        if (requestContext?.purpose === "world_narrator") {
          return JSON.stringify({
            narration: null,
            sceneNow: "三名行人在山口等待。",
            wakes: [{ actorId: "次席", urgency: "relevant", guidance: "只由你回应当前变化。", requiresResponse: false }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        if (requestContext?.actorId) actorCalls.push(requestContext.actorId);
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "我去确认前路。" }],
        });
      },
    };
    const definition = beatWorld();
    definition.actors.splice(1, 0,
      {
        id: "actor-b",
        kind: "character",
        card: { name: "次席", description: "第二名行人", personality: "果断", scenario: "在山口", messageExample: "我去。" },
      },
      {
        id: "actor-c",
        kind: "character",
        card: { name: "后卫", description: "第三名行人", personality: "谨慎", scenario: "在山口", messageExample: "等等。" },
      },
    );
    definition.contexts[0]!.actorIds = ["actor-a", "actor-b", "actor-c", "human"];
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        return {
          content: "",
          toolCalls: [{
            id: "plan-selection",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "三人探路",
                brief: "三名行人抵达山口。有人需要确认前路。",
                script: testDirectorBeatScript(["actor-a", "actor-b", "actor-c"]),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1", "A2", "A3"],
              }),
            },
          }],
        };
      },
    };
    const world = new ChatVerse({ directorProvider, characterProvider }).createWorld(definition, {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 10_000 },
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });
    await waitFor(() => actorCalls.length > 0, 2_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    world.stop();

    expect(actorCalls).toEqual(["actor-b"]);
  });

  it("does not select the same Actor for consecutive prefetched Galgame turns", async () => {
    const actorCalls: string[] = [];
    let narratorCalls = 0;
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext, userPrompt }) {
        if (requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          const previousWasActorB = userPrompt.includes("actor=次席（已在当前或缓冲队尾");
          return JSON.stringify({
            narration: narratorCalls === 1 ? "三名行人在暮色中抵达山口。" : null,
            sceneNow: "三名行人正在山口依次确认前路。",
            wakes: [{
              actorId: previousWasActorB ? "后卫" : "次席",
              urgency: "relevant",
              guidance: previousWasActorB ? "接过同伴的话，补充你的独特观察。" : "先说明你的观察。",
              requiresResponse: false,
            }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        if (requestContext?.actorId) actorCalls.push(requestContext.actorId);
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: `由${requestContext?.actorId}说明前路。` }],
        });
      },
    };
    const definition = beatWorld();
    definition.actors.splice(1, 0,
      {
        id: "actor-b",
        kind: "character",
        card: { name: "次席", description: "第二名行人", personality: "果断", scenario: "在山口", messageExample: "我先看。" },
      },
      {
        id: "actor-c",
        kind: "character",
        card: { name: "后卫", description: "第三名行人", personality: "谨慎", scenario: "在山口", messageExample: "我补充。" },
      },
    );
    definition.contexts[0]!.actorIds = ["actor-a", "actor-b", "actor-c", "human"];
    definition.contexts[0]!.runtime = {
      pacingMultiplier: 0.01,
      beatRuntime: { presentationPrefetchLimit: 2 },
    };
    definition.contexts[0]!.presentation = {
      kind: "galgame",
      playerActorId: "human",
      artDirection: "测试舞台",
      backgroundGeneration: "auto",
      acknowledgement: "required",
      openingNarrationMinimumDisplayMs: 0,
    };
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        return {
          content: "",
          toolCalls: [{
            id: "plan-prefetch-sequence",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "三人探路",
                brief: "三名行人依次确认山口前路。",
                script: testDirectorBeatScript(["actor-a", "actor-b", "actor-c"]),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1", "A2", "A3"],
              }),
            },
          }],
        };
      },
    };
    const world = new ChatVerse({ directorProvider, characterProvider }).createWorld(definition, {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 0 },
    });
    world.start();
    world.setContextPresentationMode("context-main", "stage");
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });
    await waitFor(() => actorCalls.length >= 2, 2_000);
    world.stop();

    expect(actorCalls.slice(0, 2)).toEqual(["actor-b", "actor-c"]);
  });

  it("defers Galgame Narrator arbitration while its selected Actor is still generating", async () => {
    let actorCalls = 0;
    let narratorCalls = 0;
    let resolveActor: ((value: string) => void) | undefined;
    const skippedReasons: string[] = [];
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext }) {
        if (requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          return JSON.stringify({
            narration: null,
            sceneNow: "Alice仍在处理眼前的异常，新变化刚刚抵达。",
            wakes: [{
              actorId: "Alice",
              urgency: "direct",
              guidance: "直接处理最新变化。",
              requiresResponse: true,
            }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        actorCalls++;
        return new Promise<string>((resolve) => {
          resolveActor = resolve;
        });
      },
    };
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        return {
          content: "",
          toolCalls: [{
            id: "plan-pending-turn",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "处理连续变化",
                brief: "Alice需要处理接连出现的异常。",
                script: testDirectorBeatScript(["alice"]),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const definition = interactiveWorld();
    definition.contexts[0]!.runtime = {
      ...definition.contexts[0]!.runtime,
      beatRuntime: { presentationPrefetchLimit: 2 },
    };
    definition.contexts[0]!.presentation = {
      kind: "galgame",
      playerActorId: "player",
      artDirection: "测试舞台",
      backgroundGeneration: "auto",
      acknowledgement: "required",
      openingNarrationMinimumDisplayMs: 0,
    };
    const world = new ChatVerse({ directorProvider, characterProvider }).createWorld(definition, {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 0 },
    });
    world.onNotification((notification) => {
      if (notification.type === "actor.wake_skipped") {
        skippedReasons.push(notification.payload.reason);
      }
    });
    world.start();
    world.setContextPresentationMode("chat", "stage");
    world.requestProgression({ contextId: "chat", reason: "bootstrap" });
    await waitFor(() => actorCalls === 1);

    world.emitEvent({ message: "第二个异常在第一轮处理完成前出现。", contextIds: ["chat"] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(narratorCalls).toBe(1);
    expect(actorCalls).toBe(1);
    expect(skippedReasons).not.toContain("narrator turn already pending");
    resolveActor?.(JSON.stringify({
      type: "perform",
      items: [{ kind: "message", message: "我先把两次变化合在一起处理。" }],
    }));
    await waitFor(() => narratorCalls >= 2);
    world.stop();
  });

  it("reserves a World-page player turn while its options are still generating", async () => {
    let narratorCalls = 0;
    let playerCalls = 0;
    let resolvePlayer: ((value: string) => void) | undefined;
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext }) {
        if (requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          return JSON.stringify({
            narration: narratorCalls === 1 ? "山口的碎石声在暮色里再次响起。" : null,
            sceneNow: "山口的碎石声仍在继续，玩家需要决定如何处理。",
            wakes: [{
              actorId: "玩家",
              urgency: "direct",
              guidance: "请直接决定如何处理眼前的碎石声。",
              requiresResponse: true,
            }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        if (requestContext?.purpose === "player_actor") {
          playerCalls++;
          return new Promise<string>((resolve) => {
            resolvePlayer = resolve;
          });
        }
        return JSON.stringify({ type: "silent", reason: "test" });
      },
    };
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        return {
          content: "",
          toolCalls: [{
            id: "plan-player-reservation",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "山口异响",
                brief: "玩家需要处理山口传来的碎石声。",
                script: testDirectorBeatScript(["actor-a", "human"]),
                minimumActorTurns: 2,
                contextRefs: ["C1"],
                actorRefs: ["A1", "A2"],
              }),
            },
          }],
        };
      },
    };
    const world = new ChatVerse({ directorProvider, characterProvider }).createWorld(playerTurnWorld(), {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 0 },
    });
    world.start();
    world.requestProgression({ contextId: "context-player-turn", reason: "bootstrap" });

    await waitFor(() => playerCalls === 1 && world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    )?.current?.status === "waiting_ack", 2_000);
    const beforeAck = world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    );
    expect(beforeAck?.current?.participant).toEqual({ type: "narration" });
    expect(beforeAck?.buffered[0]?.participant).toEqual({ type: "player", actorId: "human" });
    expect(beforeAck?.playerProposal).toBeUndefined();

    world.acknowledgePresentation({
      contextId: "context-player-turn",
      turnToken: beforeAck!.current!.turnToken,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(narratorCalls).toBe(1);
    expect(playerCalls).toBe(1);

    resolvePlayer?.(JSON.stringify({
      suggestions: [
        { label: "观察", performance: { action: "我先观察碎石滚落的方向。" } },
        { label: "询问", performance: { message: "我向山口喊话，询问是谁在那里。" } },
      ],
      autoPerformance: {
        label: "保持距离",
        performance: { action: "我退后半步，保持警惕。" },
      },
    }));
    await waitFor(() => Boolean(world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    )?.playerProposal), 2_000);
    expect(playerCalls).toBe(1);
    world.stop();
  });

  it("atomically prepares a scene Actor as part of the planned Beat", async () => {
    const actorCalls: string[] = [];
    const definition = beatWorld();
    definition.actors.splice(1, 0,
      {
        id: "actor-b",
        kind: "character",
        card: { name: "潜水员", description: "先遣队员", personality: "谨慎", scenario: "在舱内", messageExample: "收到。" },
      },
      {
        id: "actor-c",
        kind: "character",
        card: { name: "工程师", description: "设备工程师", personality: "严谨", scenario: "在舱内", messageExample: "先看读数。" },
      },
    );
    definition.contexts[0]!.actorIds = ["actor-a", "actor-b", "actor-c", "human"];
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        return {
          content: "",
          toolCalls: [
            {
              id: "plan-with-han-tuo",
              type: "function",
              function: {
                name: "plan_beat",
                arguments: JSON.stringify({
                  title: "检修员来报",
                  brief: "检修员韩拓刚从维修通道进入。他掌握阀门异常的第一手观察，众人需要据此判断下一步。",
                  script: {
                    ...testDirectorBeatScript(["han-tuo"]),
                    cast: [{ actorRef: "han-tuo", roleInScene: "进入舱室并报告阀门异常。" }],
                    sceneActors: [{
                      ref: "han-tuo",
                      contextRef: "C1",
                      name: "韩拓",
                      role: "刚从维修通道进入舱室的检修员",
                      personality: "直接、熟悉设备",
                      objective: "说明自己刚看到的阀门异常",
                      entrance: "从维修通道进入舱室。",
                      required: true,
                      eventRefs: ["E1"],
                    }],
                  },
                  minimumActorTurns: 8,
                  contextRefs: ["C1"],
                  actorRefs: ["han-tuo"],
                }),
              },
            },
          ],
        };
      },
    };
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext }) {
        if (requestContext?.purpose === "world_narrator") {
          return JSON.stringify({
            narration: null,
            sceneNow: "韩拓刚从维修通道进入舱室，阀门异常仍待确认。",
            wakes: [
              { actorId: "韩拓", urgency: "relevant", guidance: "说明你的来意。", requiresResponse: false },
            ],
            playerTurn: null,
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        if (requestContext?.actorId) actorCalls.push(requestContext.actorId);
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "三号阀锁扣有新裂痕，我刚从里面看见的。" }],
        });
      },
    };
    const world = new ChatVerse({ directorProvider, characterProvider }).createWorld(definition, {
      directorPolicy: {
        minIntervalMs: 0,
        debounceMs: 0,
        narratorDebounceMs: 10_000,
        maxToolRounds: 2,
      },
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });
    await waitFor(() => world.getContextMessages("context-main").some(
      (message) => message.characterName === "韩拓",
    ), 2_000);
    const snapshot = world.snapshot();
    world.stop();

    const spawned = snapshot.dynamicActors.find((actor) => (
      actor.card.name === "韩拓"
    ));
    expect(spawned).toBeDefined();
    expect(snapshot.narrative.beats[0]?.actorIds).toContain(spawned?.id);
    expect(actorCalls.length).toBeGreaterThan(0);
  });

  it("completes a Chapter only when its completing Beat resolves", async () => {
    let directorCalls = 0;
    let narratorCalls = 0;
    const definition = beatWorld();
    definition.chapters!.push({
      id: "chapter-next",
      title: "河谷决定",
      treatment: "队伍离开山口后沿河谷旧路继续调查，必须在沿途痕迹、地形风险和未知来者之间逐步确认新的通行条件。",
      targetOutcome: "队伍确认河谷旧路可安全通行，并决定继续沿河谷前进。",
      status: "queued",
      actorIds: ["actor-a"],
      contextIds: ["context-main"],
      beatIds: [],
    });
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        directorCalls++;
        if (directorCalls !== 2) return { content: "", toolCalls: [] };
        return {
          content: "",
          toolCalls: [{
            id: "phase-plan",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "确认山口异响并作出通行决定",
                brief: "行人确认山口异响的来源，并用这项证据决定是否继续通行。",
                script: testDirectorBeatScript(),
                completesChapter: true,
                minimumActorTurns: 1,
                maximumActorTurns: 4,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete(request) {
        if (request.requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          const complete = narratorCalls >= 2;
          return JSON.stringify({
            narration: null,
            sceneNow: complete ? "异响来源已经确认。" : "山口前路传来异响。",
            wakes: complete ? [] : [{ actorId: "行人", urgency: "relevant", guidance: "确认异响来源。", requiresResponse: false }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: complete ? "complete" : "continue",
            outcome: complete ? "异响来源已经确认。" : null,
          });
        }
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "异响来自前方落石，不是山中野兽。" }],
        });
      },
    };
    const world = new ChatVerse({ directorProvider, characterProvider }).createWorld(definition, {
      directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 1 },
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats[0]?.status === "completed", 2_000);
    const snapshot = world.snapshot();
    const resolvedChapter = snapshot.narrative.chapters.find((candidate) => candidate.id === "chapter-main");
    const nextChapter = snapshot.narrative.chapters.find((candidate) => candidate.id === "chapter-next");
    world.stop();

    expect(resolvedChapter).toEqual(expect.objectContaining({
      status: "completed",
      outcome: "异响来源已经确认。",
    }));
    expect(resolvedChapter?.beatIds).toHaveLength(1);
    expect(nextChapter?.status).toBe("active");
    expect(snapshot.events.some((event) => event.type === "narrative.chapter.completed")).toBe(true);
    expect(snapshot.events.some((event) => event.type === "narrative.chapter.activated")).toBe(true);
    expect(narratorCalls).toBeGreaterThanOrEqual(2);
  });

  it("asks the Director for the next Beat only after the Narrator completes the current one", async () => {
    let directorCalls = 0;
    let narratorCalls = 0;
    const directorToolFeedback: string[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete() {
        return JSON.stringify({ type: "silent" });
      },
      async chat({ messages }) {
        directorCalls++;
        directorToolFeedback.push(...messages.filter((message) => message.role === "tool").map((message) => message.content));
        if (directorCalls % 2 === 1) return { content: "", toolCalls: [] };
        const beatNumber = directorCalls / 2;
        return {
          content: "",
          toolCalls: [{
            id: `plan-${beatNumber}`,
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: `第${beatNumber}幕`,
                brief: "让眼前局面向前变化。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 1,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete(request) {
        if (request.requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          const closes = narratorCalls >= 2;
          return JSON.stringify({
            narration: null,
            sceneNow: closes ? "来者已经现身。" : "雾里有人靠近。",
            wakes: closes ? [] : [{ actorId: "行人", urgency: "relevant", guidance: "确认雾中来者。", requiresResponse: false }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: closes ? "complete" : "continue",
            outcome: closes ? "来者现身，山口异响得到确认。" : null,
          });
        }
        return JSON.stringify({ type: "perform", items: [{ kind: "action", action: "看向雾中的来者" }] });
      },
    };
    const world = new ChatVerse({ directorProvider: provider, characterProvider }).createWorld(
      beatWorld(),
      { directorPolicy: { narratorDebounceMs: 1, minIntervalMs: 0 } },
    );
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats.length === 1);
    await waitFor(() => world.snapshot().narrative.beats[0]?.status === "completed", 2_000);
    await waitFor(() => directorCalls >= 4, 2_000);

    expect(narratorCalls).toBeGreaterThanOrEqual(1);
    expect(world.snapshot().narrative.beats[0]?.outcome).toContain("异响得到确认");
    expect({ directorCalls, directorToolFeedback }).toEqual({ directorCalls: 4, directorToolFeedback: [] });
    world.stop();
  });

  it("prepares the next Galgame Beat but opens it only after the previous presentation is acknowledged", async () => {
    let directorCalls = 0;
    let firstBeatNarratorCalls = 0;
    let secondBeatNarratorCalls = 0;
    const provider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        directorCalls++;
        const second = directorCalls > 1;
        return {
          content: "",
          toolCalls: [{
            id: second ? "plan-prepared-2" : "plan-prepared-1",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: second ? "第二幕" : "第一幕",
                brief: second ? "下一幕已经准备。" : "当前一幕开始。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 1,
                maximumActorTurns: 2,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
      async complete({ userPrompt, requestContext }) {
        if (requestContext?.purpose !== "world_narrator") {
          return JSON.stringify({
            type: "perform",
            items: [{ kind: "message", message: "第一幕的责任已经完成。" }],
          });
        }
        const secondBeat = userPrompt.includes("title=第二幕");
        if (secondBeat) {
          secondBeatNarratorCalls++;
          return JSON.stringify({
            narration: "第二幕现在才正式开场。",
            sceneNow: "第二幕已经开始。",
            wakes: [],
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        firstBeatNarratorCalls++;
        const complete = firstBeatNarratorCalls > 1;
        return JSON.stringify({
          narration: complete ? "第一幕在这里收束。" : "第一幕开场。",
          sceneNow: complete ? "第一幕的责任已经完成。" : "第一幕正在进行。",
          wakes: complete ? [] : [{
            actorId: "行人",
            urgency: "direct",
            guidance: "完成第一幕责任。",
            requiresResponse: true,
          }],
          directorRequest: null,
          beatStatus: complete ? "complete" : "continue",
          outcome: complete ? "第一幕已经完成。" : null,
        });
      },
    };
    const definition = beatWorld();
    definition.contexts[0]!.presentation = {
      kind: "galgame",
      playerActorId: "human",
      artDirection: "测试舞台",
      backgroundGeneration: "auto",
      acknowledgement: "required",
    };
    definition.contexts[0]!.runtime = {
      ...definition.contexts[0]!.runtime,
      beatRuntime: { presentationPrefetchLimit: 5 },
    };
    const world = new ChatVerse({ directorProvider: provider, characterProvider: provider }).createWorld(
      definition,
      { directorPolicy: { minIntervalMs: 0, debounceMs: 0, narratorDebounceMs: 0 } },
    );
    world.start();
    world.setContextPresentationMode("context-main", "stage");
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats.some((beat) => beat.status === "prepared"), 3_000);
    const prepared = world.snapshot().narrative.beats.find((beat) => beat.status === "prepared");
    expect(prepared?.title).toBe("第二幕");
    expect(secondBeatNarratorCalls).toBe(0);

    let guard = 0;
    while (guard++ < 6) {
      const current = world.snapshot().presentationRuntime?.find(
        (entry) => entry.contextId === "context-main",
      )?.current;
      if (!current || current.beatId === prepared?.id) break;
      expect(world.acknowledgePresentation({
        contextId: "context-main",
        turnToken: current.turnToken,
      })).toBe("accepted");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await waitFor(() => secondBeatNarratorCalls === 1, 2_000);
    expect(world.snapshot().narrative.beats.find((beat) => beat.id === prepared?.id)?.status).toBe("running");
    world.stop();
  });

  it("retries an explicit Beat transition after its in-run correction remains empty", async () => {
    let directorCalls = 0;
    let narratorCalls = 0;
    const notifications: string[] = [];
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        directorCalls++;
        if (directorCalls === 1 || directorCalls === 3 || directorCalls === 4 || directorCalls === 5) {
          return { content: "", toolCalls: [] };
        }
        return {
          content: "",
          toolCalls: [{
            id: `plan-${directorCalls}`,
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: `第${directorCalls === 2 ? 1 : 2}幕`,
                brief: "让山口局面继续向前变化。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 1,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
              }),
            },
          }],
        };
      },
    };
    const characterProvider: ChatProvider = {
      ...passiveProvider,
      async complete(request) {
        if (request.requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          const closes = narratorCalls >= 2;
          return JSON.stringify({
            narration: null,
            sceneNow: closes ? "来者已经现身。" : "雾里有人靠近。",
            wakes: closes
              ? []
              : [{ actorId: "行人", urgency: "relevant", guidance: "确认雾中来者。", requiresResponse: false }],
            playerTurn: null,
            directorRequest: null,
            beatStatus: closes ? "complete" : "continue",
            outcome: closes ? "来者现身，当前一幕结束。" : null,
          });
        }
        return JSON.stringify({ type: "perform", items: [{ kind: "action", action: "看向雾中来者" }] });
      },
    };
    const world = new ChatVerse({ directorProvider, characterProvider }).createWorld(
      beatWorld(),
      { directorPolicy: { narratorDebounceMs: 1, minIntervalMs: 0, maxProviderRetries: 2 } },
    );
    world.onNotification((notification) => notifications.push(notification.type));
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats.length >= 2, 3_000);

    expect(directorCalls).toBe(6);
    expect(notifications).toContain("director.retry_scheduled");
    expect(world.snapshot().narrative.beats.at(-1)?.title).toBe("第2幕");
    world.stop();
  });

  it("requires a provider when a World binds an immutable Source revision", () => {
    const source = sourceFixture();
    const definition = beatWorld();
    definition.sources = [source.binding];

    expect(() => new ChatVerse({ provider: passiveProvider }).createWorld(definition))
      .toThrow("World Source bindings require a WorldSourceProvider");
  });

  it("rejects ambiguous duplicate Source revisions for one bundle id", () => {
    const source = sourceFixture();
    const definition = beatWorld();
    definition.sources = [source.binding, { ...source.binding, revision: source.binding.revision + 1 }];

    expect(() => new ChatVerse({ provider: passiveProvider }).createWorld(definition, {
      sourceProvider: source.provider,
    })).toThrow("World Source bundle is bound more than once");
  });

  it("retrieves Markdown once and binds the Host-owned Source provenance", async () => {
    const source = sourceFixture();
    const { binding, chunkId: sourceChunkId, provider: sourceProvider } = source;
    const directorPrompts: string[] = [];
    const toolNamesByRound: string[][] = [];
    let directorCalls = 0;
    const directorProvider: ChatProvider = {
      ...passiveProvider,
      async chat({ messages, tools }) {
        directorCalls++;
        toolNamesByRound.push((tools ?? []).map((tool) => tool.function.name));
        const prompt = messages.find((message) => message.role === "user")?.content ?? "";
        directorPrompts.push(prompt);

        return {
          content: "",
          toolCalls: [{
            id: "grounded-plan",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "江面军报",
                brief: "行人依据赤壁档案核对曹军战船与东风条件，决定下一步侦察方向。",
                script: testDirectorBeatScript(),
                minimumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1"],
                sourceAdherence: "follow",
              }),
            },
          }],
        };
      },
    };
    const definition = beatWorld();
    definition.sources = [binding];
    definition.actorMemoryPolicy = { enabled: false };
    const world = new ChatVerse({
      directorProvider,
      characterProvider: passiveProvider,
    }).createWorld(definition, {
      sourceProvider,
      directorPolicy: { minIntervalMs: 0, debounceMs: 0 },
    });
    world.start();
    world.requestProgression({ contextId: "context-main", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats.length === 1, 2_000);
    const beat = world.snapshot().narrative.beats[0];
    world.stop();

    expect(directorCalls).toBe(1);
    expect(toolNamesByRound).toEqual([[]]);
    expect(directorPrompts.some((prompt) => (
      prompt.includes("[S1-1] 江面军报")
      && prompt.includes("三份军报互相矛盾")
    ))).toBe(true);
    expect(beat).toMatchObject({
      title: "江面军报",
      sourceBasis: {
        bundleId: binding.bundleId,
        bindingRevision: binding.revision,
        chunkIds: [sourceChunkId],
        adherence: "follow",
      },
    });
  });

describe("World Player Turn", () => {
  it("generates and queues selectable options after Narrator selects the player", async () => {
    let narratorCalls = 0;
    let playerCalls = 0;
    let actorCalls = 0;
    const narratorPrompts: string[] = [];
    const provider: ChatProvider = {
      ...passiveProvider,
      async complete({ requestContext, userPrompt }) {
        if (requestContext?.purpose === "world_narrator") {
          narratorCalls++;
          narratorPrompts.push(userPrompt);
          return JSON.stringify({
            narration: null,
            sceneNow: "山口的碎石声仍在继续。",
            wakes: [{
              actorId: narratorCalls === 1 ? "玩家" : "行人",
              urgency: "direct",
              guidance: narratorCalls === 1
                ? "你要如何处理眼前的碎石声？请选择一种有实际区别的回应。"
                : "直接回应玩家刚才的喊话。",
              requiresResponse: true,
            }],
            directorRequest: null,
            beatStatus: "continue",
            outcome: null,
          });
        }
        if (requestContext?.purpose === "player_actor") {
          playerCalls++;
          return JSON.stringify({
            suggestions: [
              { label: "先观察", performance: { action: "我先观察碎石滚落的方向。" } },
              { label: "直接询问", performance: { message: "我向山口喊话，询问是谁在那里。" } },
            ],
            autoPerformance: {
              label: "保持距离",
              performance: { action: "我退后半步，保持警惕。" },
            },
          });
        }
        actorCalls++;
        return JSON.stringify({ type: "silent", reason: "test" });
      },
      async chat() {
        return {
          content: "",
          toolCalls: [{
            id: "plan-player-turn",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "山口异响",
                brief: "确认山口碎石声的来源。",
                script: testDirectorBeatScript(["actor-a", "human"]),
                minimumActorTurns: 2,
                contextRefs: ["C1"],
                actorRefs: ["A1", "A2"],
              }),
            },
          }],
        };
      },
    };
    const definition = playerTurnWorld();
    const world = new ChatVerse({
      directorProvider: provider,
      characterProvider: provider,
    }).createWorld(definition);
    world.start();
    world.requestProgression({ contextId: "context-player-turn", reason: "bootstrap" });

    await waitFor(() => world.snapshot().narrative.beats.length === 1);
    await waitFor(() => world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    )?.current?.status === "waiting_ack");
    const opening = world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    )?.current;
    expect(opening?.participant).toEqual({ type: "narration" });
    expect(world.acknowledgePresentation({
      contextId: "context-player-turn",
      turnToken: opening!.turnToken,
    })).toBe("accepted");

    await waitFor(() => world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    )?.current?.status === "waiting_player");
    const runtime = world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    );
    expect(narratorCalls).toBe(1);
    expect(playerCalls).toBe(1);
    expect(actorCalls).toBe(0);
    expect(narratorPrompts[0]).toContain("[Eligible wake Actors]\n行人, 玩家");
    expect(runtime?.playerProposal?.suggestions).toHaveLength(2);
    expect(runtime?.playerProposal?.autoPerformance.performance).toEqual({
      action: "我退后半步，保持警惕。",
    });
    world.submitPlayerTurn({
      contextId: "context-player-turn",
      actorId: "human",
      proposalId: runtime?.playerProposal?.id,
      performance: {
        action: "我走到山口前，抬手示意。",
        message: "我向山口喊话，询问是谁在那里。",
      },
    });
    await waitFor(() => narratorCalls >= 2);
    expect(narratorPrompts[1]).toContain("actorTurns=1");
    const playerTurnEvents = world.snapshot().events.filter((event) => (
      event.actorId === "human" && (
        event.type === "context.action.committed" ||
        event.type === "context.message.committed"
      )
    ));
    expect(playerTurnEvents).toHaveLength(2);
    expect(new Set(playerTurnEvents.map((event) => event.correlationId ?? event.id)).size).toBe(1);
    expect(world.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    )?.current?.participant).toEqual({ type: "player", actorId: "human" });
    world.stop();

    narratorCalls = 0;
    actorCalls = 0;
    const standardDefinition = playerTurnWorld();
    delete standardDefinition.contexts[0]!.presentation;
    const standardWorld = new ChatVerse({
      directorProvider: provider,
      characterProvider: provider,
    }).createWorld(standardDefinition);
    standardWorld.start();
    standardWorld.requestProgression({ contextId: "context-player-turn", reason: "bootstrap" });
    await waitFor(() => standardWorld.snapshot().presentationRuntime?.find(
      (entry) => entry.contextId === "context-player-turn",
    )?.current?.status === "waiting_player");
    expect(actorCalls).toBe(0);
    standardWorld.stop();
  });
});

function playerTurnWorld(): WorldDefinition {
  return {
    metadata: { id: "player-turn-world", name: "Player Turn World" },
    actors: [
      {
        id: "actor-a",
        kind: "character",
        card: {
          name: "行人",
          description: "经过山口的人",
          personality: "谨慎",
          scenario: "正在穿过山口",
          messageExample: "先看看再说。",
        },
      },
      {
        id: "human",
        kind: "character",
        playerControlled: true,
        card: {
          name: "玩家",
          description: "山口旅人",
          personality: "谨慎",
          scenario: "刚刚抵达山口。",
          messageExample: "先看看再说。",
        },
        playerCard: {
          name: "玩家",
          identity: "山口旅人",
          background: "刚刚抵达山口。",
          personality: "谨慎",
          appearance: "背着行囊。",
          speechStyle: "简洁直接。",
          boundaries: "不替其他角色作决定。",
        },
      },
    ],
    contexts: [{
      id: "context-player-turn",
      kind: "chat",
      name: "山口",
      actorIds: ["actor-a", "human"],
      scene: { groupName: "山口", topic: "穿过山口", atmosphere: "暮色" },
      runtime: {
        pacingMultiplier: 0.01,
        beatRuntime: { presentationPrefetchLimit: 2 },
      },
      initiallyActive: true,
      presentation: {
        kind: "galgame",
        playerActorId: "human",
        artDirection: "测试舞台",
        backgroundGeneration: "auto",
        acknowledgement: "required",
        openingNarrationMinimumDisplayMs: 0,
      },
    }],
    chapters: [{
      id: "chapter-player-turn",
      title: "山口异响",
      treatment: "玩家与同行者在山口面对持续逼近的异响，需要通过观察、询问和试探逐步确认来源，并决定是否继续前进。",
      targetOutcome: "玩家与同行者确认异响来源，并作出是否继续穿过山口的决定。",
      status: "active",
      actorIds: ["actor-a", "human"],
      contextIds: ["context-player-turn"],
      beatIds: [],
    }],
    relations: [],
    directorPolicy: { enabled: true, minIntervalMs: 0, debounceMs: 0 },
  };
}

function beatWorld(): WorldDefinition {
  return {
    metadata: { id: "beat-world", name: "Beat World", description: "A compact runtime test." },
    lore: {
      entries: [{
        keys: [],
        content: "山口并不安全。",
        priority: 1,
        position: "before",
        constant: true,
      }],
    },
    actors: [
      {
        id: "actor-a",
        kind: "character",
        card: {
          name: "行人",
          description: "经过山口的人",
          personality: "谨慎",
          scenario: "正在穿过山口",
          messageExample: "先看看再说。",
        },
      },
      { id: "human", kind: "character", playerControlled: true, card: testCard("玩家", "在场者") },
    ],
    contexts: [{
      id: "context-main",
      kind: "chat",
      name: "山口",
      actorIds: ["actor-a", "human"],
      scene: { groupName: "山口", topic: "穿过山口", atmosphere: "暮色", state: "flowing" },
      runtime: { pacingMultiplier: 0.01 },
      initiallyActive: true,
    }],
    relations: [],
    chapters: [{
      id: "chapter-main",
      title: "山口来者",
      treatment: "行人在山口追查异响背后的来者，经过现场观察、风险确认和来者交涉逐步建立可信判断。",
      targetOutcome: "行人确认山口来者的身份与意图，并决定是否让其同行。",
      status: "active",
      actorIds: ["actor-a"],
      contextIds: ["context-main"],
      beatIds: [],
    }],
    directorPolicy: { enabled: true, minIntervalMs: 0, debounceMs: 0 },
  };
}

function sourceFixture(): {
  binding: { bundleId: string; revision: number; fidelity: "strict" };
  chunkId: string;
  provider: WorldSourceProvider;
} {
  const binding = {
    bundleId: "red-cliff-source",
    revision: 2,
    fidelity: "strict" as const,
  };
  const chunkId = "red-cliff-source:chunk:river-report";
  const provider: WorldSourceProvider = {
    validate(bindings) {
      return bindings.every((candidate) => (
        candidate.bundleId === binding.bundleId && candidate.revision === binding.revision
      )) ? [] : ["Source bundle is unavailable."];
    },
    catalog() {
      return [{
        bundleId: binding.bundleId,
        revision: binding.revision,
        name: "赤壁战前档案",
        description: "Director Source 集成测试资料。",
        documentCount: 1,
        sectionCount: 1,
        chunkCount: 1,
      }];
    },
    outline() {
      return [{
        id: "red-cliff-source:section:river-report",
        bundleId: binding.bundleId,
        documentId: "red-cliff-source:document:red-cliff",
        title: "江面军报",
        level: 2,
        chunkCount: 1,
        chunkIds: [chunkId],
      }];
    },
    search() {
      return [{
        chunkId,
        bundleId: binding.bundleId,
        documentId: "red-cliff-source:document:red-cliff",
        sectionId: "red-cliff-source:section:river-report",
        title: "江面军报",
        excerpt: "曹军战船沿江列阵，东风尚未稳定。",
        score: 3.2,
      }];
    },
    read(_binding, chunkIds) {
      return chunkIds.includes(chunkId)
        ? [{
            id: chunkId,
            bundleId: binding.bundleId,
            documentId: "red-cliff-source:document:red-cliff",
            sectionId: "red-cliff-source:section:river-report",
            title: "江面军报",
            text: "曹军战船沿江列阵，但三份军报互相矛盾。东风尚未稳定。",
          }]
        : [];
    },
  };
  return { binding, chunkId, provider };
}

describe("World debug observability", () => {
  it("stays inert by default and emits an ordered diagnostic stream when enabled", async () => {
    const chatverse = new ChatVerse({ provider: passiveProvider });
    const disabled = chatverse.createWorld(humanOnlyWorld());
    const disabledEvents: number[] = [];
    disabled.onDebug((event) => disabledEvents.push(event.sequence));
    disabled.start();
    disabled.sendMessage({ contextId: "chat", actorId: "player", message: "private" });
    await waitFor(() => disabled.getContextMessages("chat").length === 1);
    expect(disabledEvents).toEqual([]);
    expect(disabled.debugSnapshot().events).toEqual([]);
    disabled.stop();

    const enabled = chatverse.createWorld(humanOnlyWorld(), {
      debug: { enabled: true, maxEvents: 100 },
    });
    const observed: number[] = [];
    enabled.onDebug((event) => {
      observed.push(event.sequence);
      if (event.type === "context.message.committed") {
        throw new Error("debug observer failure");
      }
    });
    enabled.start();
    enabled.sendMessage({ contextId: "chat", actorId: "player", message: "visible" });
    await waitFor(() => enabled.getContextMessages("chat").length === 1);

    const snapshot = enabled.debugSnapshot();
    enabled.stop();
    expect(snapshot.contexts[0]?.contextId).toBe("chat");
    expect(snapshot.events.some(
      (event) => event.type === "context.message.committed",
    )).toBe(true);
    expect(observed).toEqual([...observed].sort((left, right) => left - right));
    expect(snapshot.lastDebugSequence).toBe(
      snapshot.events[snapshot.events.length - 1]?.sequence,
    );
  });

  it("redacts Director prompts unless prompt tracing is explicitly enabled", async () => {
    const provider: ChatProvider = {
      ...passiveProvider,
      async chat() {
        return {
          content: "internal provider content",
          toolCalls: [{
            id: "finish",
            type: "function",
            function: { name: "finish", arguments: "{}" },
          }],
        };
      },
    };
    const definition = humanOnlyWorld();
    definition.directorPolicy = { enabled: true };
    const world = new ChatVerse({ provider }).createWorld(definition, {
      directorPolicy: { enabled: true, debounceMs: 0, minIntervalMs: 0 },
      debug: { enabled: true, tracePrompts: false, traceResponses: false },
    });
    world.start();
    world.requestProgression({ contextId: "chat" });
    await waitFor(() => world.debugSnapshot().events.some(
      (event) => event.type === "director.response",
    ));
    const snapshot = world.debugSnapshot();
    world.stop();

    const prompt = snapshot.events.find((event) => event.type === "director.prompt");
    const response = snapshot.events.find((event) => event.type === "director.response");
    expect(prompt?.payload).not.toHaveProperty("systemPrompt");
    expect(prompt?.payload).not.toHaveProperty("userPrompt");
    expect(response?.payload).not.toHaveProperty("content");
    expect(response?.payload).toHaveProperty("toolCalls");
  });
});

describe("ActorGenerationCoordinator", () => {
  it("allows different Actors to hold generation leases concurrently", async () => {
    const coordinator = new ActorGenerationCoordinator();
    const aliceRelease = await coordinator.acquire("alice", 10);
    const bobRelease = await coordinator.acquire("bob", 10);

    bobRelease();
    aliceRelease();
  });

  it("serializes one actor globally and gives queued priority precedence", async () => {
    const coordinator = new ActorGenerationCoordinator();
    const firstRelease = await coordinator.acquire("alice", 10);
    const order: string[] = [];
    const low = coordinator.acquire("alice", 10).then((release) => {
      order.push("low");
      release();
    });
    const high = coordinator.acquire("alice", 100).then((release) => {
      order.push("high");
      release();
    });

    firstRelease();
    await Promise.all([low, high]);
    expect(order).toEqual(["high", "low"]);
  });

  it("removes a cancelled waiter without poisoning the next lease", async () => {
    const coordinator = new ActorGenerationCoordinator();
    const firstRelease = await coordinator.acquire("alice", 10);
    const controller = new AbortController();
    const cancelled = coordinator.acquire("alice", 20, controller.signal);

    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    firstRelease();
    const nextRelease = await coordinator.acquire("alice", 5);
    nextRelease();
  });
});

function testCard(name: string, description: string) {
  return {
    name,
    description,
    personality: "由参与者决定",
    scenario: "正在当前场景中",
    messageExample: "",
  };
}

function humanOnlyWorld(): WorldDefinition {
  return {
    metadata: { id: "world-test", name: "World Test" },
    actors: [{
      id: "player",
      kind: "character",
      playerControlled: true,
      card: testCard("Player", "A participant"),
    }],
    contexts: [{
      id: "chat",
      kind: "chat",
      name: "Test Chat",
      actorIds: ["player"],
      initiallyActive: true,
      scene: {
        groupName: "Test Chat",
        topic: "Testing",
        atmosphere: "quiet",
      },
    }],
    chapters: [{
      id: "chapter-main",
      title: "Main chapter",
      treatment: "A traveler and the people at the old bridge must investigate an emerging danger across several scenes, weighing evidence, trust, and the cost of moving forward.",
      targetOutcome: "The group confirms the source of the danger and commits to a safe next route.",
      status: "active",
      actorIds: ["player"],
      contextIds: ["chat"],
      beatIds: [],
    }],
    directorPolicy: { enabled: false },
  };
}

function sharedActorWorld(): WorldDefinition {
  return {
    metadata: { id: "shared-world", name: "Shared World" },
    actors: [{
      id: "alice",
      kind: "character",
      card: {
        name: "Alice",
        description: "Test actor",
        personality: "calm",
        scenario: "",
          messageExample: "",
      },
    }],
    contexts: [
      {
        id: "first",
        kind: "chat",
        name: "First",
        actorIds: ["alice"],
        scene: { groupName: "First", topic: "one", atmosphere: "quiet" },
      },
      {
        id: "second",
        kind: "chat",
        name: "Second",
        actorIds: ["alice"],
        scene: { groupName: "Second", topic: "two", atmosphere: "quiet" },
      },
    ],
    directorPolicy: { enabled: false },
  };
}

function aiWorld(): WorldDefinition {
  return {
    metadata: { id: "ai-world", name: "AI World" },
    actors: [{
      id: "alice",
      kind: "character",
      card: {
        name: "Alice",
        description: "Observer",
        personality: "quiet",
        scenario: "inside",
        messageExample: "",
      },
    }],
    contexts: [{
      id: "chat",
      kind: "chat",
      name: "AI Chat",
      actorIds: ["alice"],
      scene: { groupName: "AI Chat", topic: "weather", atmosphere: "quiet" },
    }],
    chapters: [{
      id: "chapter-main",
      title: "Main chapter",
      treatment: "Alice observes a changing situation at the old bridge and gradually gathers enough evidence to decide how the shared investigation should continue.",
      targetOutcome: "Alice confirms the immediate cause of the disturbance and chooses the next investigation route.",
      status: "active",
      actorIds: ["alice"],
      contextIds: ["chat"],
      beatIds: [],
    }],
    directorPolicy: { enabled: true },
  };
}

function interactiveWorld(): WorldDefinition {
  const definition = aiWorld();
  definition.metadata = { id: "interactive-world", name: "Interactive World" };
  definition.actors.push({
    id: "player",
    kind: "character",
    playerControlled: true,
    card: testCard("Player", "A participant"),
  });
  definition.contexts[0]!.actorIds.push("player");
  definition.contexts[0]!.initiallyActive = true;
  definition.contexts[0]!.runtime = {
    pacingMultiplier: 0.25,
    actorRuntime: {
      activation: "beat_runtime",
      playerRouting: "focus_actor",
      ambient: "low",
    },
  };
  definition.actorMemoryPolicy = { enabled: false };
  return definition;
}

function twoActorWorld(): WorldDefinition {
  const definition = aiWorld();
  definition.metadata = { id: "two-actor-world", name: "Two Actor World" };
  definition.actors.push({
    id: "bob",
    kind: "character",
    card: {
      name: "Bob",
      description: "Another observer",
      personality: "careful",
      scenario: "inside",
      messageExample: "",
    },
  });
  definition.contexts[0]!.actorIds.push("bob");
  definition.directorPolicy = { enabled: false };
  return definition;
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function testBeatScript(actorIds: string[] = ["actor-a"]) {
  return {
    time: "当前",
    location: "当前 Context",
    cast: actorIds.map((actorId) => ({ actorId, roleInScene: "推动当前局面" })),
    cause: "当前压力已经显现。",
    development: ["当前压力显现。", "角色采取行动。", "角色取得新的可观察结果。"],
    turningPoint: "新的结果改变角色可采取的行动。",
    result: "当前问题得到一个不可撤回的阶段结果。",
    causalChain: ["压力迫使角色行动。", "行动产生新结果。", "新结果改变后续选择。"],
  };
}

function consolidateActorMemory(world: unknown, actorIds: string[]): void {
  (world as {
    actorMemoryUpdates: { consolidate(ids: readonly string[], reason?: string): void };
  }).actorMemoryUpdates.consolidate(actorIds, "beat_completed:test");
}

function testDirectorActorRef(actorId: string): string {
  if (/^A\d+$/.test(actorId)) return actorId;
  if (actorId === "actor-a" || actorId === "alice") return "A1";
  if (actorId === "actor-b" || actorId === "human" || actorId === "player") return "A2";
  if (actorId === "actor-c") return "A3";
  return actorId;
}

function testDirectorBeatScript(actorIds: string[] = ["actor-a"]) {
  const script = testBeatScript(actorIds);
  return {
    ...script,
    cast: actorIds.map((actorId) => ({
      actorRef: testDirectorActorRef(actorId),
      roleInScene: "推动当前局面",
    })),
  };
}
