import { describe, expect, it } from "vitest";
import {
  formatContextTimeline,
  projectChatTimeline,
  projectIncrementalTimeline,
} from "./timeline.js";

describe("Context timeline", () => {
  it("uses one chronological projection for messages and actions", () => {
    const timeline = projectChatTimeline(
      [{ id: "m1", characterName: "甲", message: "先说话", timestamp: 10, source: "character" }],
      [{ id: "a1", characterName: "乙", action: "随后起身", timestamp: 20 }],
    );

    expect(formatContextTimeline(timeline, 1_000)).toBe([
      "【甲】：先说话",
      "【乙（动作）】：随后起身",
    ].join("\n"));
  });

  it("keeps the newest tail when a shared timeline exceeds its budget", () => {
    const rendered = formatContextTimeline([
      { id: "old", timestamp: 1, order: 1, text: "旧".repeat(20) },
      { id: "new", timestamp: 2, order: 2, text: "最新事实" },
    ], 12);

    expect(rendered).toContain("更早的逐条记录已省略");
    expect(rendered).toContain("最新事实");
  });

  it("projects only the rows appended after the checkpoint", () => {
    const rows = [
      { timestamp: 1, order: 1, text: "第一条" },
      { timestamp: 2, order: 2, text: "第二条" },
      { timestamp: 3, order: 3, text: "第三条" },
    ];
    const checkpoint = {
      summary: "前情摘要",
      facts: ["关键事实"],
      throughSequence: 1,
      curatedAt: 1,
    };
    const projection = projectIncrementalTimeline(checkpoint, rows);
    expect(projection.pendingRowCount).toBe(2);
    expect(projection.block).toContain("前情摘要");
    expect(projection.block).toContain("第二条");
    expect(projection.block).toContain("第三条");
    expect(projection.block).not.toContain("第一条");
  });

  it("keeps the projected prefix stable when new rows are appended", () => {
    const base = [
      { timestamp: 1, order: 1, text: "第一条" },
      { timestamp: 2, order: 2, text: "第二条" },
    ];
    const checkpoint = { summary: "", facts: [], throughSequence: 0, curatedAt: 0 };
    const first = projectIncrementalTimeline(checkpoint, base);
    const extended = projectIncrementalTimeline(checkpoint, [
      ...base,
      { timestamp: 3, order: 3, text: "第三条" },
    ]);
    // 同一 checkpoint 下,旧行的前缀在追加后保持不变(append-only)。
    expect(extended.block.startsWith(first.block.split("【新增事件】")[0]!)).toBe(true);
  });

  it("resets pending rows to zero after a fold checkpoint advances", () => {
    const rows = [
      { timestamp: 1, order: 1, text: "第一条" },
      { timestamp: 2, order: 2, text: "第二条" },
      { timestamp: 3, order: 3, text: "第三条" },
    ];
    const folded = {
      summary: "折叠后的摘要",
      facts: [],
      throughSequence: 3,
      curatedAt: 2,
    };
    const projection = projectIncrementalTimeline(folded, rows);
    expect(projection.pendingRowCount).toBe(0);
    expect(projection.block).not.toContain("【新增事件】");
    expect(projection.block).toContain("折叠后的摘要");
  });
});
