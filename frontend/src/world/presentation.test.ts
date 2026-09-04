import { describe, expect, it } from "vitest";
import {
  buildPresentationSegments,
  buildStoryTimeline,
  orderPresentationEntries,
  presentationDrainDelayMs,
  streamedTextLength,
  selectStageActor,
  selectPresentationTurnEntries,
} from "./presentation";
import type { WorldViewBeat, WorldViewEntry } from "./types";

describe("presentation entries", () => {
  it("shows only the actor who owns the current stage entry, including the player", () => {
    const actors = [
      { id: "actor-1", name: "庄方宜", kind: "character" as const, playerControlled: false, availability: "available" as const },
      { id: "player-1", name: "管理员", kind: "character" as const, playerControlled: true, availability: "available" as const },
    ];
    const playerEntry = { ...entry("human", "我来处理。", 1), actorId: "player-1", actorName: "管理员" };

    expect(selectStageActor(actors, playerEntry)?.id).toBe("player-1");
    expect(selectStageActor(actors, entry("narration", "风停了。", 2))).toBeUndefined();
  });

  it("keeps actions and all messages in their original turn order", () => {
    const entries: WorldViewEntry[] = [
      entry("action", "抬手推开门", 1),
      entry("character", "里面有人吗？", 2),
      entry("character", "我进来了。", 3),
    ];

    const result = buildPresentationSegments(entries);

    expect(result.map((segment) => [segment.entry.kind, segment.text])).toEqual([
      ["action", "庄方宜 抬手推开门"],
      ["character", "里面有人吗？"],
      ["character", "我进来了。"],
    ]);
  });

  it("follows the server turn order and waits for every entry", () => {
    const action = entry("action", "抬手推开门", 1);
    const message = entry("character", "里面有人吗？", 2);

    expect(selectPresentationTurnEntries([message, action], [action.id, message.id]).map((item) => item.id)).toEqual([
      action.id,
      message.id,
    ]);
    expect(selectPresentationTurnEntries([action], [action.id, message.id])).toEqual([]);
    expect(orderPresentationEntries([message, action], [action.id, message.id]).map((item) => item.id)).toEqual([
      action.id,
      message.id,
    ]);
  });

  it("still presents an action-only turn once", () => {
    const result = buildPresentationSegments([entry("action", "转身离开", 1)]);

    expect(result.map((segment) => segment.text)).toEqual(["庄方宜 转身离开"]);
  });

  it("retains the complete acknowledged turn while the next turn is generating", () => {
    const previous = [
      entry("action", "抬手推开门", 1),
      entry("character", "里面有人吗？", 2),
    ];
    const timeline = [...previous, entry("action", "侧身观察", 3)];

    const result = selectPresentationTurnEntries(timeline, [], previous);

    expect(result.map((item) => item.id)).toEqual(["entry-1", "entry-2"]);
    expect(buildPresentationSegments(result).map((segment) => segment.text)).toEqual([
      "庄方宜 抬手推开门",
      "里面有人吗？",
    ]);
  });

  it("paces every current turn in the world timeline", () => {
    const narration = entry("narration", "12345", 1);

    expect(presentationDrainDelayMs([narration], 1, 2, undefined, 1_000)).toBe(1_000);
    expect(presentationDrainDelayMs([narration], 1, 0, undefined, 1_000)).toBe(1_000);
    expect(presentationDrainDelayMs([narration], 1, 2, 8_000, 1_000)).toBe(7_000);
  });

  it("streams consecutive entries using the selected pacing", () => {
    expect(streamedTextLength("12345", 200, 1)).toBe(3);
    expect(streamedTextLength("12345", 600, 1)).toBe(5);
    expect(streamedTextLength("12345", 1_000, 2)).toBe(5);
    expect(streamedTextLength("12345", 3_000, 1, 10)).toBe(5);
    expect(streamedTextLength("12345", 0, 0)).toBe(5);
  });

  it("keeps Beat markers and narration in journal order when world time is unchanged", () => {
    const beats = [beat("beat-1", 1), beat("beat-2", 4), beat("beat-3", 7)];
    const entries = [
      { ...entry("narration", "第一幕", 2), occurredAt: 1_000 },
      { ...entry("character", "第一幕回应", 3), occurredAt: 1_000 },
      { ...entry("narration", "第二幕", 5), occurredAt: 1_000 },
      { ...entry("character", "第二幕回应", 6), occurredAt: 1_000 },
      { ...entry("narration", "第三幕", 8), occurredAt: 1_000 },
    ];

    expect(buildStoryTimeline(entries, beats).map((item) => item.id)).toEqual([
      "beat:beat-1",
      "entry:entry-2",
      "entry:entry-3",
      "beat:beat-2",
      "entry:entry-5",
      "entry:entry-6",
      "beat:beat-3",
      "entry:entry-8",
    ]);
  });
});

function entry(kind: WorldViewEntry["kind"], text: string, sequence: number): WorldViewEntry {
  return {
    id: `entry-${sequence}`,
    sequence,
    kind,
    actorId: "actor-1",
    actorName: "庄方宜",
    text,
    occurredAt: sequence,
  };
}

function beat(id: string, sequence: number): WorldViewBeat {
  return {
    id,
    sequence,
    chapterId: "chapter-1",
    title: id,
    brief: `${id} brief`,
    script: {
      time: `${id} time`,
      location: `${id} location`,
      cast: [{ actorId: "actor-1", roleInScene: `${id} role` }],
      cause: `${id} cause`,
      development: [`${id} starts`, `${id} changes`, `${id} advances`],
      turningPoint: `${id} turns`,
      result: `${id} result`,
      causalChain: [`${id} cause leads to action`, `${id} action leads to turn`, `${id} turn leads to result`],
    },
    completesChapter: false,
    minimumActorTurns: 1,
    maximumActorTurns: 4,
    status: "running",
    contextIds: ["context-1"],
    actorIds: ["actor-1"],
    sourceEventIds: [],
    occurredAt: 1_000,
  };
}
