import { describe, expect, it } from "vitest";
import type {
  PlayerPerformance,
  PlayerTurnProposal,
  PresentationRuntimeSnapshot,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import { PresentationController, type PresentationControllerHost } from "./controller.js";

function proposal(): PlayerTurnProposal {
  return {
    id: "proposal-1",
    contextId: "context-1",
    beatId: "beat-1",
    suggestions: [
      { label: "询问", performance: { message: "先问清楚发生了什么。" } },
      { label: "行动", performance: { action: "向前一步，观察现场。" } },
    ],
    autoPerformance: {
      label: "自动代演",
      performance: { message: "我先保持谨慎，看看现场的变化。" },
    },
  };
}

function createController(openingMinimumMs = 0) {
  let clock = 1_000;
  let id = 0;
  const notifications: Array<{ type: WorldNotificationType; payload: unknown }> = [];
  const acknowledgements: Array<{
    beatId: string;
    promoted: boolean;
    participant: string;
    entryIds: string[];
  }> = [];
  const performances: Array<{ performance: PlayerPerformance; skipped: boolean }> = [];
  const host: PresentationControllerHost = {
    now: () => clock,
    nextId: () => `turn-${++id}`,
    openingMinimumMs: () => openingMinimumMs,
    playerActorId: () => "player-1",
    prefetchLimit: () => 5,
    commitPlayerPerformance: (_contextId, _actorId, performance) => {
      performances.push({ performance, skipped: false });
      return ["entry-player"];
    },
    onPlayerPerformanceCommitted: (_contextId, _beatId, _entryIds, skipped) => {
      if (skipped) performances.push({ performance: {}, skipped: true });
    },
    onPresentationAcknowledged: (_contextId, beatId, promoted, turn) => {
      acknowledgements.push({
        beatId,
        promoted,
        participant: turn.participant.type,
        entryIds: [...turn.entryIds],
      });
    },
    notify: <TType extends WorldNotificationType>(
      type: TType,
      payload: WorldNotificationPayloadMap[TType],
    ) => {
      notifications.push({ type, payload });
    },
  };
  return {
    controller: new PresentationController(host),
    notifications,
    acknowledgements,
    performances,
    advance(ms: number) {
      clock += ms;
    },
  };
}

describe("PresentationController", () => {
  it("removes an existing opening acknowledgement delay in stage mode", () => {
    const test = createController(10_000);
    test.controller.startBeat("context-1", "beat-1");
    test.controller.queueTurn("context-1", "beat-1", { type: "narration" }, ["entry-opening"]);
    const token = test.controller.current("context-1")!.turnToken;

    expect(test.controller.acknowledgePresentation("context-1", token)).toBe("too_early");
    test.controller.setTimingBypass("context-1", true);
    expect(test.controller.acknowledgePresentation("context-1", token)).toBe("accepted");
  });

  it("keeps one visible turn and a bounded prefetched queue, then resumes Narrator after ACK", () => {
    const test = createController();
    test.controller.startBeat("context-1", "beat-1");

    expect(test.controller.queueTurn("context-1", "beat-1", { type: "narration" }, ["entry-opening"])).toBe(true);
    expect(test.controller.queueTurn("context-1", "beat-1", { type: "actor", actorId: "actor-1" }, ["entry-actor"])).toBe(true);
    expect(test.controller.queueTurn("context-1", "beat-1", { type: "actor", actorId: "actor-2" }, ["entry-actor-2"])).toBe(true);

    const current = test.controller.current("context-1");
    expect(current?.participant).toEqual({ type: "narration" });
    expect(test.controller.snapshot()[0]?.buffered[0]?.participant).toEqual({ type: "actor", actorId: "actor-1" });
    expect(test.controller.latestQueuedParticipant("context-1")).toEqual({ type: "actor", actorId: "actor-2" });

    expect(test.controller.acknowledgePresentation("context-1", current!.turnToken)).toBe("accepted");
    const promoted = test.controller.current("context-1");
    expect(promoted?.participant).toEqual({ type: "actor", actorId: "actor-1" });
    expect(test.acknowledgements).toEqual([{
      beatId: "beat-1",
      promoted: true,
      participant: "narration",
      entryIds: ["entry-opening"],
    }]);

    expect(test.controller.acknowledgePresentation("context-1", promoted!.turnToken)).toBe("accepted");
    expect(test.acknowledgements).toEqual([
      {
        beatId: "beat-1",
        promoted: true,
        participant: "narration",
        entryIds: ["entry-opening"],
      },
      {
        beatId: "beat-1",
        promoted: true,
        participant: "actor",
        entryIds: ["entry-actor"],
      },
    ]);
    const secondActor = test.controller.current("context-1");
    expect(secondActor?.participant).toEqual({ type: "actor", actorId: "actor-2" });
    expect(test.controller.acknowledgePresentation("context-1", secondActor!.turnToken)).toBe("accepted");
    expect(test.controller.current("context-1")).toBeUndefined();
  });

  it("does not enqueue the same committed entries twice", () => {
    const test = createController();
    test.controller.startBeat("context-1", "beat-1");

    expect(test.controller.queueTurn(
      "context-1",
      "beat-1",
      { type: "actor", actorId: "actor-1" },
      ["entry-1", "entry-2"],
    )).toBe(true);
    expect(test.controller.queueTurn(
      "context-1",
      "beat-1",
      { type: "actor", actorId: "actor-1" },
      ["entry-1", "entry-2"],
    )).toBe(false);
    expect(test.controller.snapshot()[0]?.current?.entryIds).toEqual(["entry-1", "entry-2"]);
  });

  it("keeps a player gate behind visible narration and commits one performance", () => {
    const test = createController();
    test.controller.startBeat("context-1", "beat-1");
    test.controller.queueTurn("context-1", "beat-1", { type: "narration" }, ["entry-opening"]);

    expect(test.controller.queuePlayerTurn("context-1", "beat-1")).toBe(true);
    const snapshot = test.controller.snapshot()[0] as PresentationRuntimeSnapshot;
    expect(snapshot.current?.participant).toEqual({ type: "narration" });
    expect(snapshot.buffered[0]?.participant).toEqual({ type: "player", actorId: "player-1" });
    expect(snapshot.playerProposal).toBeUndefined();
    expect(test.controller.setPlayerProposal("context-1", "beat-1", proposal())).toBe(true);
    expect(test.controller.snapshot()[0]?.playerProposal?.id).toBe("proposal-1");

    const openingToken = snapshot.current!.turnToken;
    expect(test.controller.acknowledgePresentation("context-1", openingToken)).toBe("accepted");
    expect(test.controller.current("context-1")?.status).toBe("waiting_player");

    expect(test.controller.submitPlayerTurn(
      "context-1",
      "player-1",
      "proposal-1",
      { action: "抬头观察山路。" },
    )).toBe(true);
    const playerTurn = test.controller.current("context-1");
    expect(playerTurn?.participant).toEqual({ type: "player", actorId: "player-1" });
    expect(playerTurn?.entryIds).toEqual(["entry-player"]);
    expect(test.performances).toEqual([{ performance: { action: "抬头观察山路。" }, skipped: false }]);
  });

  it("reserves the player gate before generation and keeps its proposal behind earlier turns", () => {
    const test = createController();
    test.controller.startBeat("context-1", "beat-1");
    test.controller.queueTurn("context-1", "beat-1", { type: "narration" }, ["entry-opening"]);
    test.controller.queueTurn("context-1", "beat-1", { type: "actor", actorId: "actor-1" }, ["entry-before-player"]);

    expect(test.controller.queuePlayerTurn("context-1", "beat-1")).toBe(true);
    expect(test.controller.queuePlayerTurn("context-1", "beat-1")).toBe(false);
    expect(test.controller.playerTurn("context-1", "beat-1")?.status).toBe("waiting_player");
    expect(test.controller.setPlayerProposal("context-1", "beat-1", proposal())).toBe(true);

    let snapshot = test.controller.snapshot()[0] as PresentationRuntimeSnapshot;
    expect(snapshot.current?.participant).toEqual({ type: "narration" });
    expect(snapshot.buffered.map((turn) => turn.participant)).toEqual([
      { type: "actor", actorId: "actor-1" },
      { type: "player", actorId: "player-1" },
    ]);
    expect(snapshot.playerProposal?.id).toBe("proposal-1");

    expect(test.controller.acknowledgePresentation("context-1", snapshot.current!.turnToken)).toBe("accepted");
    snapshot = test.controller.snapshot()[0] as PresentationRuntimeSnapshot;
    expect(snapshot.current?.participant).toEqual({ type: "actor", actorId: "actor-1" });
    expect(snapshot.playerProposal?.id).toBe("proposal-1");

    expect(test.controller.acknowledgePresentation("context-1", snapshot.current!.turnToken)).toBe("accepted");
    snapshot = test.controller.snapshot()[0] as PresentationRuntimeSnapshot;
    expect(snapshot.current?.participant).toEqual({ type: "player", actorId: "player-1" });
    expect(snapshot.playerProposal?.id).toBe("proposal-1");
  });

  it("reserves a player gate even when the generated buffer is full", () => {
    const test = createController();
    test.controller.startBeat("context-1", "beat-1");
    expect(test.controller.queueTurn("context-1", "beat-1", { type: "narration" }, ["entry-opening"])).toBe(true);
    for (let index = 0; index < 5; index++) {
      expect(test.controller.queueTurn(
        "context-1",
        "beat-1",
        { type: "actor", actorId: `actor-${index}` },
        [`entry-${index}`],
      )).toBe(true);
    }

    expect(test.controller.queuePlayerTurn("context-1", "beat-1")).toBe(true);
    const snapshot = test.controller.snapshot()[0] as PresentationRuntimeSnapshot;
    expect(snapshot.buffered).toHaveLength(6);
    expect(snapshot.buffered.at(-1)?.participant).toEqual({ type: "player", actorId: "player-1" });
    expect(test.controller.canPrefetch("context-1")).toBe(false);
  });

  it("resumes prefetch immediately after the player submits a choice", () => {
    const test = createController();
    test.controller.startBeat("context-1", "beat-1");
    expect(test.controller.queuePlayerTurn("context-1", "beat-1", proposal())).toBe(true);
    expect(test.controller.canPrefetch("context-1")).toBe(false);

    expect(test.controller.submitPlayerTurn(
      "context-1",
      "player-1",
      "proposal-1",
      { message: "我选择当面问清楚。" },
    )).toBe(true);

    expect(test.controller.current("context-1")?.status).toBe("waiting_ack");
    expect(test.controller.canPrefetch("context-1")).toBe(true);
    expect(test.controller.queueTurn(
      "context-1",
      "beat-1",
      { type: "actor", actorId: "actor-1" },
      ["entry-response"],
    )).toBe(true);
    expect(test.controller.snapshot()[0]?.buffered).toHaveLength(1);
  });

  it("keeps stage mode across Beat changes and caps the prefetched queue at five", () => {
    const test = createController();
    test.controller.setMode("context-1", "stage", 0.8);
    test.controller.startBeat("context-1", "beat-2");
    expect(test.controller.snapshot()[0]?.mode).toBe("stage");
    expect(test.controller.queueTurn("context-1", "beat-2", { type: "narration" }, ["entry-current"])).toBe(true);
    for (let index = 0; index < 5; index++) {
      expect(test.controller.queueTurn(
        "context-1",
        "beat-2",
        { type: "actor", actorId: `actor-${index}` },
        [`entry-${index}`],
      )).toBe(true);
    }
    expect(test.controller.queueTurn(
      "context-1",
      "beat-2",
      { type: "actor", actorId: "actor-overflow" },
      ["entry-overflow"],
    )).toBe(false);
    expect(test.controller.snapshot()[0]?.buffered).toHaveLength(5);
  });
});
