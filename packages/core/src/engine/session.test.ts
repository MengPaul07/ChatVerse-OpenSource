import { describe, expect, it } from "vitest";
import type { SessionConfig } from "../contracts/chat.js";
import type { ChatProvider, ProviderUsageEvent } from "../contracts/provider.js";
import type { RuntimeHost } from "../runtime/types.js";
import { InProcessRuntimeHost, ManualRuntimeHost } from "../runtime/in-process.js";
import { Session } from "./session.js";

const provider: ChatProvider = {
  async complete() { return ""; },
  async *stream() { /* not used by this test */ },
  async chat() { return { content: "", toolCalls: [] }; },
};

function createSession(
  config: SessionConfig,
  sessionProvider: ChatProvider = provider,
  runtime?: RuntimeHost,
): Session {
  return new Session(
    config,
    { character: sessionProvider },
    runtime ?? new InProcessRuntimeHost(),
  );
}

describe("Session initial history", () => {
  it("uses committed initial messages as Core history", () => {
    const initialMessages = [{
      id: "before-restart",
      characterName: "Alice",
      message: "We already agreed on the plan.",
      timestamp: 1_000,
      source: "character" as const,
    }];
    const session = createSession({
      characters: [],
      scene: { groupName: "Resume test", topic: "test", atmosphere: "quiet" },
      relations: [],
      initialMessages,
    });

    expect(session.messages).toEqual(initialMessages);
    expect(session.snapshot().messages).toEqual(initialMessages);
  });
});

describe("Session pacing", () => {
  it("applies the global multiplier to message and action delays", () => {
    const session = createSession({
      characters: [],
      scene: { groupName: "Pacing test", topic: "test", atmosphere: "quiet" },
      relations: [],
      pacingMultiplier: 2,
    });
    const timing = session as unknown as {
      computeTypingDelaySec(message: string, hesitationSec?: number): number;
      computeActionDelaySec(action: string, hesitationSec?: number): number;
    };

    expect(timing.computeTypingDelaySec("1234567890")).toBe(8);
    expect(timing.computeActionDelaySec("123456789012")).toBeCloseTo(3.6);
  });
});

describe("Session history compression", () => {
  it("compresses old history in the background without removing raw messages", async () => {
    const compressionProvider: ChatProvider = {
      async complete({ onUsage }) {
        onUsage?.({
          inputTokens: 240,
          outputTokens: 32,
          totalTokens: 272,
          provider: "test",
          model: "compression-fixed",
        });
        return JSON.stringify({
          summary: "Earlier messages established a monitoring plan.",
          recentFacts: ["The monitoring plan is still active."],
        });
      },
      async *stream() { /* not used by this test */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const session = createSession({
      characters: [],
      scene: { groupName: "Compression test", topic: "test", atmosphere: "quiet" },
      relations: [],
      debug: { enabled: true },
      contextCompression: {
        historyTokenThreshold: 120,
        recentHistoryTokens: 60,
        summaryMaxTokens: 120,
        factsLimit: 3,
      },
    }, compressionProvider);
    const usageEvents: ProviderUsageEvent[] = [];
    session.onProviderUsage((event) => usageEvents.push(event));

    for (let index = 0; index < 4; index++) {
      session.sendHumanMessage({ participantName: "Tester", message: `message-${index} ${"x".repeat(130)}` });
    }

    const iterator = session.start()[Symbol.asyncIterator]();
    for (let index = 0; index < 4; index++) await iterator.next();

    await waitFor(() => Boolean(session.snapshot().conversationDigest?.throughMessageId));
    session.stop();

    const snapshot = session.snapshot();
    expect(snapshot.messages).toHaveLength(4);
    expect(snapshot.conversationDigest?.summary).toContain("monitoring plan");
    expect(snapshot.conversationDigest?.recentFacts).toEqual(["The monitoring plan is still active."]);
    expect(session.debugEvents.some((event) => event.type === "context.compression_completed")).toBe(true);
    expect(session.debugEvents).toContainEqual(expect.objectContaining({
      type: "provider.usage",
      providerRole: "history_compression",
      requestContext: expect.objectContaining({
        purpose: "history_compression",
      }),
      usage: expect.objectContaining({
        totalTokens: 272,
      }),
    }));
    expect(usageEvents).toContainEqual(expect.objectContaining({
      providerRole: "history_compression",
      operation: "complete",
      requestContext: expect.objectContaining({ purpose: "history_compression" }),
      usage: expect.objectContaining({ totalTokens: 272 }),
    }));
  });
});

describe("Harness silent continuation", () => {
  it("commits ordered actions separately from chat messages", async () => {
    const harnessProvider: ChatProvider = {
      async complete() {
        return JSON.stringify({
          type: "perform",
          items: [
            { kind: "action", action: "慢慢靠近石缝，侧耳听了听" },
            { kind: "message", message: "有人来了。" },
          ],
        });
      },
      async *stream() { /* not used by this test */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const host = new ManualRuntimeHost(1_000);
    const session = createSession({
      characters: [{
        name: "Alice",
        description: "测试角色",
        personality: "警觉",
        scenario: "正在石缝旁",
        messageExample: "",
      }],
      scene: { groupName: "Action test", topic: "测试", atmosphere: "安静" },
      relations: [],
    }, harnessProvider, host);
    const notifications: string[] = [];
    session.onRuntimeNotification((notification) => notifications.push(notification.type));
    const internal = session as unknown as {
      runHarnessCharacterDecision(
        trigger: { type: "event"; target: string; priority: number },
        scheduleCursor: number,
      ): Promise<void>;
      flushScheduledMessages(): AsyncGenerator<import("../contracts/chat.js").ChatMessage>;
    };

    await internal.runHarnessCharacterDecision(
      { type: "event", target: "Alice", priority: 10 },
      host.clock.now(),
    );
    host.advanceBy(60_000);
    const result = await internal.flushScheduledMessages().next();

    expect(session.actions).toEqual([expect.objectContaining({
      characterName: "Alice",
      action: "慢慢靠近石缝，侧耳听了听",
    })]);
    expect(result.value).toMatchObject({
      characterName: "Alice",
      message: "有人来了。",
    });
    expect(notifications).toContain("action.committed");
    expect(session.snapshot().actions).toEqual(session.actions);
  });

  it("wakes the in-process runner when a generated message reaches its send time", async () => {
    const harnessProvider: ChatProvider = {
      async complete() {
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "定时消息已经到了。" }],
        });
      },
      async *stream() { /* not used by this test */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const host = new InProcessRuntimeHost();
    const session = createSession({
      characters: [{
        name: "Alice",
        description: "测试角色",
        personality: "简洁",
        scenario: "正在群聊中",
        messageExample: "定时消息已经到了。",
      }],
      scene: { groupName: "Realtime runner", topic: "测试", atmosphere: "安静" },
      relations: [],
      pacingMultiplier: 0.25,
    }, harnessProvider, host);
    const internal = session as unknown as {
      runHarnessCharacterDecision(
        trigger: { type: "event"; target: string; priority: number },
        scheduleCursor: number,
      ): Promise<void>;
    };

    await internal.runHarnessCharacterDecision(
      { type: "event", target: "Alice", priority: 100 },
      host.clock.now(),
    );
    const iterator = session.start()[Symbol.asyncIterator]();
    const result = await withTimeout(iterator.next(), 2_500);
    session.stop();

    expect(result.value?.message).toBe("定时消息已经到了。");
    expect(session.snapshotDebugState().queues.scheduled).toHaveLength(0);
  });

  it("forces a new message after three consecutive model-decided silences by default", async () => {
    const prompts: string[] = [];
    const harnessProvider: ChatProvider = {
      async complete(params) {
        prompts.push(params.userPrompt);
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "我补充一句。" }],
        });
      },
      async *stream() { /* not used by this test */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const host = new ManualRuntimeHost(1_000);
    const session = createSession({
      characters: [{
        name: "Alice",
        description: "测试角色",
        personality: "简洁",
        scenario: "正在群聊中",
        messageExample: "我补充一句。",
      }],
      scene: { groupName: "Harness test", topic: "测试", atmosphere: "自然" },
      relations: [],
    }, harnessProvider, host);
    const internal = session as unknown as {
      _characterRuntime: Map<string, { characterName: string; consecutiveSilentCount?: number }>;
      runHarnessCharacterDecision(
        trigger: { type: "idle"; target: string; priority: number },
        scheduleCursor: number,
      ): Promise<void>;
    };
    internal._characterRuntime.set("Alice", { characterName: "Alice", consecutiveSilentCount: 3 });

    await internal.runHarnessCharacterDecision({ type: "idle", target: "Alice", priority: 10 }, host.clock.now());

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("已经连续 3 次选择 silent");
    expect(session.snapshotDebugState().queues.scheduled).toHaveLength(1);
  });

  it("does not count passive idle backoff toward the forced-speech liveness guard", () => {
    const host = new ManualRuntimeHost(1_000);
    const session = createSession({
      characters: [{
        name: "Alice",
        description: "测试角色",
        personality: "简洁",
        scenario: "正在群聊中",
        messageExample: "我补充一句。",
      }],
      scene: { groupName: "Harness test", topic: "测试", atmosphere: "自然" },
      relations: [],
    }, provider, host);
    const runtime = {
      characterName: "Alice",
      consecutiveSilentCount: 2,
      passiveBackoffCount: 1,
      lastDecisionAt: 900,
    };
    const internal = session as unknown as {
      _characterRuntime: Map<string, typeof runtime & { idleCheckAt?: number }>;
      schedulePassiveIdleBackoff(
        characterName: string,
        current: typeof runtime,
        now: number,
      ): number;
      shouldForceHarnessContinuation(current: typeof runtime): boolean;
    };

    const nextIdleSec = internal.schedulePassiveIdleBackoff("Alice", runtime, host.clock.now());
    const updated = internal._characterRuntime.get("Alice");

    expect(nextIdleSec).toBeGreaterThan(0);
    expect(updated?.consecutiveSilentCount).toBe(2);
    expect(updated?.passiveBackoffCount).toBe(2);
    expect(internal.shouldForceHarnessContinuation(updated!)).toBe(false);
  });

  it("aborts an in-flight character request when the session stops", async () => {
    let observedSignal: AbortSignal | undefined;
    const pendingProvider: ChatProvider = {
      complete({ signal }) {
        observedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      async *stream() { /* not used by this test */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const session = createSession({
      characters: [{
        name: "Alice",
        description: "Test actor",
        personality: "quiet",
        scenario: "testing",
        messageExample: "",
      }],
      scene: { groupName: "Abort test", topic: "test", atmosphere: "quiet" },
      relations: [],
    }, pendingProvider);
    const internal = session as unknown as {
      runHarnessCharacterDecision(
        trigger: { type: "idle"; target: string; priority: number },
        scheduleCursor: number,
      ): Promise<void>;
    };
    const decision = internal.runHarnessCharacterDecision(
      { type: "idle", target: "Alice", priority: 10 },
      Date.now(),
    ).catch(() => undefined);
    await waitFor(() => Boolean(observedSignal));

    session.stop();
    await decision;

    expect(observedSignal?.aborted).toBe(true);
    expect(session.snapshotDebugState().queues.scheduled).toHaveLength(0);
  });

  it("continues flushing due messages while a character request is pending", async () => {
    let requestStarted = false;
    const pendingProvider: ChatProvider = {
      complete({ signal }) {
        requestStarted = true;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason ?? new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      },
      async *stream() { /* not used by this test */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const host = new ManualRuntimeHost(10_000);
    const session = createSession({
      characters: [{
        name: "Alice",
        description: "Test actor",
        personality: "quiet",
        scenario: "testing",
        messageExample: "",
      }],
      scene: { groupName: "Non-blocking Harness", topic: "test", atmosphere: "quiet" },
      relations: [],
    }, pendingProvider, host);
    const internal = session as unknown as {
      _triggerQueue: {
        enqueue(
          trigger: {
            type: "event";
            target: string;
            priority: number;
            enqueuedAt: number;
            message: string;
          },
          isBusy: () => boolean,
        ): string;
      };
      _scheduledQueue: {
        schedule(input: {
          id: string;
          now: number;
          speaker: string;
          message: string;
          outputKind: "message";
          sendAt: number;
        }): unknown;
      };
      runner: { wake(): void };
    };
    internal._triggerQueue.enqueue({
      type: "event",
      target: "Alice",
      priority: 100,
      enqueuedAt: host.clock.now(),
      message: "test event",
    }, () => false);
    // A second queued trigger must not cause a microtask spin while the first
    // character request is still running.
    internal._triggerQueue.enqueue({
      type: "event",
      target: "Alice",
      priority: 90,
      enqueuedAt: host.clock.now(),
      message: "second test event",
    }, () => false);

    const iterator = session.start()[Symbol.asyncIterator]();
    const nextMessage = iterator.next();
    await waitFor(() => requestStarted);

    internal._scheduledQueue.schedule({
      id: "scheduled-during-generation",
      now: host.clock.now(),
      speaker: "Alice",
      message: "This message was already ready.",
      outputKind: "message",
      sendAt: host.clock.now() + 1_000,
    });
    internal.runner.wake();
    await Promise.resolve();
    await Promise.resolve();
    host.advanceBy(1_000);

    const result = await nextMessage;
    session.stop();

    expect(result.value?.message).toBe("This message was already ready.");
    expect(session.snapshotDebugState().queues.generating).toHaveLength(0);
  });

  it("hard-interrupts every queued Actor output when user narration changes the scene", () => {
    const host = new ManualRuntimeHost(10_000);
    const session = createSession({
      characters: [{
        name: "Alice",
        description: "Test actor",
        personality: "quiet",
        scenario: "testing",
        messageExample: "",
      }],
      scene: { groupName: "Narration interrupt", topic: "test", atmosphere: "quiet" },
      relations: [],
      interventionCommitWindowMs: 5_000,
    }, provider, host);
    const internal = session as unknown as {
      _triggerQueue: {
        enqueue(
          trigger: { type: "event"; target: string; priority: number; enqueuedAt: number; message: string },
          isBusy: () => boolean,
        ): string;
      };
      _scheduledQueue: {
        schedule(input: {
          id: string;
          now: number;
          speaker: string;
          message: string;
          outputKind: "message";
          sendAt: number;
        }): unknown;
      };
    };
    internal._triggerQueue.enqueue({
      type: "event",
      target: "Alice",
      priority: 80,
      enqueuedAt: host.clock.now(),
      message: "old scene cue",
    }, () => false);
    internal._scheduledQueue.schedule({
      id: "old-scene-message",
      now: host.clock.now(),
      speaker: "Alice",
      message: "This must never be sent.",
      outputKind: "message",
      sendAt: host.clock.now() + 100,
    });

    session.interruptPendingActorWork("user narration replaced the scene");

    expect(session.snapshotDebugState().queues.triggers).toHaveLength(0);
    expect(session.snapshotDebugState().queues.scheduled).toHaveLength(0);
  });

  it("arms only one autonomous opening opportunity for a Group", () => {
    const host = new ManualRuntimeHost(1_000);
    const session = createSession({
      conversationMode: "group",
      characters: ["Alice", "Bob", "Cathy"].map((name) => ({
        name,
        description: "测试角色",
        personality: "自然",
        scenario: "正在群聊中",
        messageExample: "我补充一句。",
      })),
      scene: { groupName: "Sparse Group", topic: "测试", atmosphere: "自然" },
      relations: [],
    }, provider, host);
    const internal = session as unknown as {
      initializeGroupAutonomousIdle(): void;
      markGroupActivity(speakers: readonly string[], source: "human" | "character"): void;
      _characterRuntime: Map<string, { idleCheckAt?: number; idleReason?: string; idleRevision?: number }>;
    };

    internal.initializeGroupAutonomousIdle();

    const armed = [...internal._characterRuntime.values()].filter((runtime) => runtime.idleCheckAt !== undefined);
    expect(armed).toHaveLength(1);
    expect(armed[0]?.idleReason).toBe("opening");

    internal.markGroupActivity(["Alice"], "human");

    const responseCandidates = [...internal._characterRuntime.values()].filter((runtime) => runtime.idleCheckAt !== undefined);
    expect(responseCandidates.length).toBeGreaterThan(0);
    expect(responseCandidates.length).toBeLessThanOrEqual(2);
    expect(responseCandidates.every((runtime) => runtime.idleReason === "response" && runtime.idleRevision === 1)).toBe(true);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for runtime output.")), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
