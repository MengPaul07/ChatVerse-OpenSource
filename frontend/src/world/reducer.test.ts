import { describe, expect, it } from "vitest";
import type {
  WorldEvent,
  WorldEventPayloadMap,
  WorldNotification,
  WorldNotificationPayloadMap,
} from "@chatverse/core";
import {
  initialWorldRoomState,
  worldRoomReducer,
} from "./reducer";
import type { WorldView } from "./types";

describe("worldRoomReducer", () => {
  it("projects a blocking provider issue into the room runtime", () => {
    const loaded = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const next = worldRoomReducer(loaded, {
      type: "world_notification",
      sequence: 1,
      notification: notification("provider.blocked", {
        operation: "narrator",
        kind: "billing",
        status: 402,
        message: "insufficient balance",
        userMessage: "模型服务余额不足或额度已用尽，请充值或更换 API Key 后再继续。",
      }),
    });

    expect(next.view?.runtime.providerIssue).toMatchObject({
      kind: "billing",
      status: 402,
      operation: "narrator",
    });
  });

  it("projects foreground recovery lifecycle without adding chat entries", () => {
    let state = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const expected = {
      id: "recovery-1",
      contextId: "chat",
      operation: "narrator" as const,
      responsibility: "arbitrate_turn" as const,
      status: "expected" as const,
      attempt: 0,
      maxAutomaticRetries: 1,
      expectedAt: 100,
      lastProgressAt: 100,
      beatId: "beat-1",
    };

    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 1,
      notification: notification("runtime.operation_expected", { recovery: expected }),
    });
    expect(state.view?.contexts[0]?.recovery).toEqual(expected);
    expect(state.view?.entries).toEqual([]);

    const running = {
      ...expected,
      status: "running" as const,
      lastProgressAt: 110,
    };
    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 2,
      notification: notification("runtime.operation_started", { recovery: running }),
    });
    expect(state.view?.contexts[0]?.recovery?.status).toBe("running");

    const retryScheduled = {
      ...expected,
      status: "retry_scheduled" as const,
      attempt: 1,
      retryAt: 250,
      lastProgressAt: 120,
    };
    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 3,
      notification: notification("runtime.retry_scheduled", { recovery: retryScheduled }),
    });
    expect(state.view?.contexts[0]?.recovery).toMatchObject({
      id: "recovery-1",
      status: "retry_scheduled",
      attempt: 1,
    });

    const failed = {
      ...retryScheduled,
      status: "failed" as const,
      failure: {
        id: "failure-1",
        kind: "timeout" as const,
        message: "request timed out",
        userMessage: "模型长时间没有返回结果。",
        retryable: true,
        occurredAt: 300,
      },
    };
    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 4,
      notification: notification("runtime.operation_failed", { recovery: failed }),
    });
    expect(state.view?.contexts[0]?.recovery?.failure?.id).toBe("failure-1");
    expect(state.view?.entries).toEqual([]);

    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 5,
      notification: notification("runtime.operation_recovered", {
        contextId: "chat",
        recoveryId: "recovery-1",
        operation: "narrator",
      }),
    });
    expect(state.view?.contexts[0]?.recovery).toBeUndefined();
    expect(state.view?.entries).toEqual([]);
  });

  it("does not clear a newer foreground recovery with a stale recovered notification", () => {
    const view = baseView();
    view.contexts[0].recovery = {
      id: "recovery-new",
      contextId: "chat",
      operation: "actor",
      responsibility: "perform_turn",
      status: "running",
      attempt: 0,
      maxAutomaticRetries: 1,
      expectedAt: 100,
      lastProgressAt: 110,
      actorId: "alice",
    };
    const loaded = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view,
    });
    const next = worldRoomReducer(loaded, {
      type: "world_notification",
      sequence: 1,
      notification: notification("runtime.operation_recovered", {
        contextId: "chat",
        recoveryId: "recovery-old",
        operation: "narrator",
      }),
    });

    expect(next.view?.contexts[0]?.recovery?.id).toBe("recovery-new");
  });

  it("projects unread auto-pause state for one conversation only", () => {
    const loaded = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const next = worldRoomReducer(loaded, {
      type: "context_runtime",
      sequence: 1,
      contextId: "chat",
      unreadCount: 1,
      status: "paused",
      pauseReason: "unread",
    });

    expect(next.view?.contexts[0]).toMatchObject({
      unreadCount: 1,
      status: "paused",
      pauseReason: "unread",
    });
  });

  it("keeps a loaded world recoverable when a runtime action fails", () => {
    const loaded = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const failed = worldRoomReducer(loaded, {
      type: "action_error",
      message: "世界当前未运行。",
    });

    expect(failed.phase).toBe("ready");
    expect(failed.view?.world.status).toBe("running");
    expect(failed.error).toBe("世界当前未运行。");
  });

  it("projects committed narration, beats, chapters, and Director state", () => {
    let state = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    state = worldRoomReducer(state, {
      type: "world_event",
      sequence: 1,
      event: event("narrative.narration.committed", {
        narration: {
          id: "narration-1",
          contextId: "chat",
          text: "山风忽然停了。",
          sourceEventIds: ["source"],
          occurredAt: 100,
        },
      }),
    });
    state = worldRoomReducer(state, {
      type: "world_event",
      sequence: 2,
      event: event("narrative.beat.recorded", {
        beat: {
          id: "beat-1",
          chapterId: "chapter-1",
          title: "山风停下",
          brief: "环境发生了可追溯的变化。",
          script: {
            time: "黄昏",
            location: "五行山山口",
            cast: [],
            cause: "异常已经出现。",
            development: ["异常出现。", "现场发生变化。", "异常结果显露。"],
            turningPoint: "新的结果改变选择。",
            result: "异常已经得到确认。",
          causalChain: ["异常促使调查。", "调查产生结果。", "结果改变选择。"],
        },
        completesChapter: false,
          minimumActorTurns: 8,
          maximumActorTurns: 14,
          status: "running",
          actorIds: [],
          contextIds: ["chat"],
          sourceEventIds: ["source"],
          occurredAt: 100,
        },
        chapter: {
          id: "chapter-1",
          title: "山中异变",
          treatment: "追踪五行山的异常变化，并在多场调查后确认其来源。",
          targetOutcome: "确认异常来源并决定是否继续深入山中。",
          status: "active",
          actorIds: [],
          contextIds: ["chat"],
          beatIds: ["beat-1"],
        },
      }, undefined, 2),
    });
    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 3,
      notification: notification("director.scheduled", {
        dueAt: 250,
        delayMs: 150,
        reason: "observer_continue",
      }),
    });

    expect(state.view?.entries[0]?.text).toBe("山风忽然停了。");
    expect(state.view?.contexts[0]?.scene?.text).toBe("山风忽然停了。");
    expect(state.view?.narrative.beats[0]?.id).toBe("beat-1");
    expect(state.view?.narrative.chapters[0]?.beatIds).toEqual(["beat-1"]);
    expect(state.view?.world.eventSequence).toBe(2);
    expect(state.view?.director).toEqual({
      status: "scheduled",
      dueAt: 250,
      reason: "observer_continue",
    });
    expect(state.view?.lastStreamSequence).toBe(3);
  });

  it("deduplicates replayed transport events", () => {
    const loaded = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const action = {
      type: "world_event" as const,
      sequence: 1,
      event: event("context.message.committed", {
        message: {
          id: "message-1",
          characterName: "你",
          message: "你好",
          timestamp: 100,
          source: "human",
        },
      }, "player"),
    };
    const once = worldRoomReducer(loaded, action);
    const replayed = worldRoomReducer(once, action);

    expect(replayed.view?.entries).toHaveLength(1);
    expect(replayed.view?.entries[0]?.kind).toBe("human");
  });

  it("projects the foreground Chapter selected by the Director", () => {
    const loaded = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const focused = worldRoomReducer(loaded, {
      type: "world_event",
      sequence: 1,
      event: event("narrative.chapter.focus_changed", {
        fromChapterId: "chapter-a",
        toChapterId: "chapter-b",
        reason: "switched",
        beatId: "beat-b",
      }),
    });

    expect(focused.view?.narrative.foregroundChapterId).toBe("chapter-b");
  });

  it("projects actor actions as non-message timeline entries", () => {
    const loaded = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: {
        ...baseView(),
        actors: [{
          id: "alice",
          name: "Alice",
          kind: "character",
          playerControlled: false,
          availability: "available",
        }],
      },
    });
    const state = worldRoomReducer(loaded, {
      type: "world_event",
      sequence: 1,
      event: event("context.action.committed", {
        action: {
          id: "action-1",
          characterName: "Alice",
          action: "慢慢靠近石缝",
          timestamp: 100,
        },
      }, "alice"),
    });

    expect(state.view?.entries[0]).toMatchObject({
      kind: "action",
      actorName: "Alice",
      text: "慢慢靠近石缝",
    });
  });

  it("projects Actor presence, participation, and control changes", () => {
    let state = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    state = worldRoomReducer(state, {
      type: "world_event",
      sequence: 1,
      event: event("actor.presence.changed", {
        before: {
          actorId: "player",
          presence: "online",
          revision: 0,
          updatedAt: 99,
        },
        after: {
          actorId: "player",
          presence: "away",
          status: "巡查中",
          revision: 1,
          updatedAt: 100,
        },
        source: "system",
      }, "player"),
    });
    state = worldRoomReducer(state, {
      type: "world_event",
      sequence: 2,
      event: event("actor.participation.changed", {
        before: {
          actorId: "player",
          contextId: "chat",
          participation: "joined",
          joinedAtSequence: 0,
          lastSeenSequence: 0,
          updatedAt: 99,
        },
        after: {
          actorId: "player",
          contextId: "chat",
          participation: "muted",
          joinedAtSequence: 0,
          lastSeenSequence: 2,
          updatedAt: 100,
        },
        source: "user",
      }, "player"),
    });
    state = worldRoomReducer(state, {
      type: "world_event",
      sequence: 3,
      event: event("actor.control.changed", {
        before: {
          actorId: "player",
          policy: {
            directorAuthority: "coordinate",
          },
          updatedAt: 99,
        },
        after: {
          policy: {
            directorAuthority: "observe",
          },
          actorId: "player",
          updatedAt: 100,
        },
        source: "user",
      }, "player"),
    });

    expect(state.view?.actors[0]).toMatchObject({
      presence: "away",
      availability: "away",
      status: "巡查中",
      contexts: [{ contextId: "chat", participation: "muted" }],
      control: {
        directorAuthority: "observe",
      },
    });
  });

  it("keeps prefetched Galgame turns behind the current presentation", () => {
    let state = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const current = {
      turnToken: "turn-current",
      contextId: "chat",
      beatId: "beat",
      participant: { type: "narration" as const },
      entryIds: ["entry-current"],
      status: "waiting_ack" as const,
    };
    const buffered = {
      turnToken: "turn-buffered",
      contextId: "chat",
      beatId: "beat",
      participant: { type: "actor" as const, actorId: "alice" },
      entryIds: ["entry-buffered"],
      status: "waiting_ack" as const,
    };
    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 1,
      notification: notification("presentation.waiting_ack", {
        contextId: "chat",
        beatId: "beat",
        turn: current,
      }),
    });
    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 2,
      notification: notification("presentation.waiting_ack", {
        contextId: "chat",
        beatId: "beat",
        turn: buffered,
        buffered: true,
      }),
    });

    expect(state.view?.contexts[0]?.presentationTurn?.turnToken).toBe("turn-current");
    expect(state.view?.contexts[0]?.bufferedPresentationCount).toBe(1);

    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 3,
      notification: notification("presentation.waiting_ack", {
        contextId: "chat",
        beatId: "beat",
        turn: buffered,
      }),
    });
    expect(state.view?.contexts[0]?.presentationTurn?.turnToken).toBe("turn-buffered");
    expect(state.view?.contexts[0]?.bufferedPresentationCount).toBe(0);
  });

  it("keeps a buffered player gate hidden until earlier turns are acknowledged", () => {
    let state = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    const current = {
      turnToken: "turn-current",
      contextId: "chat",
      beatId: "beat",
      participant: { type: "narration" as const },
      entryIds: ["entry-current"],
      status: "waiting_ack" as const,
    };
    const player = {
      turnToken: "turn-player",
      contextId: "chat",
      beatId: "beat",
      participant: { type: "player" as const, actorId: "player" },
      entryIds: [],
      status: "waiting_player" as const,
    };
    const proposal = {
      id: "proposal-1",
      contextId: "chat",
      beatId: "beat",
      suggestions: [
        { label: "询问", performance: { message: "先问清楚。" } },
        { label: "观察", performance: { action: "观察现场。" } },
      ],
      autoPerformance: { label: "自动代演", performance: { message: "先保持谨慎。" } },
    };

    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 1,
      notification: notification("presentation.waiting_ack", {
        contextId: "chat",
        beatId: "beat",
        turn: current,
      }),
    });
    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 2,
      notification: notification("presentation.waiting_player", {
        contextId: "chat",
        beatId: "beat",
        turn: player,
        proposal,
        buffered: true,
      }),
    });

    expect(state.view?.contexts[0]?.presentationTurn?.turnToken).toBe("turn-current");
    expect(state.view?.contexts[0]?.playerProposal).toBeUndefined();
    expect(state.view?.contexts[0]?.bufferedPresentationCount).toBe(1);

    state = worldRoomReducer(state, {
      type: "world_notification",
      sequence: 3,
      notification: notification("presentation.waiting_player", {
        contextId: "chat",
        beatId: "beat",
        turn: player,
        proposal,
      }),
    });

    expect(state.view?.contexts[0]?.presentationTurn?.turnToken).toBe("turn-player");
    expect(state.view?.contexts[0]?.playerProposal?.id).toBe("proposal-1");
    expect(state.view?.contexts[0]?.bufferedPresentationCount).toBe(0);
  });

  it("adds a Director-spawned Actor before projecting its context membership", () => {
    let state = worldRoomReducer(initialWorldRoomState, {
      type: "view_loaded",
      view: baseView(),
    });
    state = worldRoomReducer(state, {
      type: "world_event",
      sequence: 1,
      event: event("actor.registered", {
        kind: "character",
        playerControlled: false,
        name: "巡山小妖",
        description: "负责盘查山路的狼妖哨兵",
        lifecycle: "scene",
        relationCount: 0,
      }, "spawned-actor"),
    });
    state = worldRoomReducer(state, {
      type: "world_event",
      sequence: 2,
      event: event("actor.participation.changed", {
        before: {
          actorId: "spawned-actor",
          contextId: "chat",
          participation: "left",
          joinedAtSequence: 0,
          lastSeenSequence: 0,
          updatedAt: 100,
        },
        after: {
          actorId: "spawned-actor",
          contextId: "chat",
          participation: "joined",
          joinedAtSequence: 2,
          lastSeenSequence: 2,
          updatedAt: 100,
        },
        source: "director",
      }, "spawned-actor"),
    });

    expect(state.view?.actors.find((actor) => actor.id === "spawned-actor"))
      .toMatchObject({
        name: "巡山小妖",
        kind: "character",
        description: "负责盘查山路的狼妖哨兵",
        presence: "online",
        availability: "available",
        contexts: [{ contextId: "chat", participation: "joined" }],
      });
  });
});

function baseView(): WorldView {
  return {
    roomId: "room",
    world: {
      id: "world",
      archiveId: "archive",
      name: "Test",
      status: "running",
      worldTime: 100,
      eventSequence: 0,
    },
    runtime: {
      directorEnabled: true,
      actorMemoryEnabled: true,
      room: {
        viewerCount: 1,
        autoPauseEnabled: true,
        autoPauseAfterMs: 300_000,
      },
    },
    contexts: [{
      id: "chat",
      name: "Chat",
      actorIds: [],
      status: "active",
      pacingMultiplier: 1,
      scene: {
        id: "scene-initial",
        contextId: "chat",
        text: "quiet\nweather",
        sourceEventIds: [],
        occurredAt: 100,
      },
      actorRuntime: {
        activation: "beat_runtime",
        playerRouting: "focus_actor",
        ambient: "low",
      },
      presentationMode: "world",
      presentationPrefetchLimit: 5,
    }],
    actors: [{
      id: "player",
      name: "你",
      kind: "character",
      playerControlled: true,
      availability: "available",
    }],
    entries: [],
    narrative: {
      beats: [],
      edges: [],
      chapters: [],
    },
    director: { status: "idle" },
    lastStreamSequence: 0,
  };
}

function event<TType extends WorldEvent["type"]>(
  type: TType,
  payload: WorldEventPayloadMap[TType],
  actorId?: string,
  sequence = 1,
): WorldEvent<TType> {
  return {
    id: `event-${type}`,
    worldId: "world",
    sequence,
    type,
    occurredAt: 100,
    contextId: "chat",
    actorId,
    payload,
  } as WorldEvent<TType>;
}

function notification<TType extends WorldNotification["type"]>(
  type: TType,
  payload: WorldNotificationPayloadMap[TType],
): WorldNotification<TType> {
  return {
    worldId: "world",
    sequence: 1,
    occurredAt: 100,
    type,
    payload,
  } as WorldNotification<TType>;
}
