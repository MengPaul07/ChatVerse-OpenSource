import { describe, expect, it } from "vitest";
import { resolveDirectorToolChoice } from "./agent.js";
import { WORLD_DIRECTOR_SYSTEM_PROMPT, buildWorldDirectorUserPrompt } from "./prompt.js";
import { worldDirectorBeatRoundTools } from "./tools.js";
import { createDirectorReferenceTable } from "./references.js";
import type { WorldDirectorView } from "./types.js";

describe("World Director Beat contract", () => {
  it("plans one Chapter Beat and keeps the next pressure behind closure", () => {
    expect(WORLD_DIRECTOR_SYSTEM_PROMPT).toContain("一个 Beat 必须只服务当前 Chapter 的一个阶段性进展");
    expect(WORLD_DIRECTOR_SYSTEM_PROMPT).toContain("nextPressure 是闭幕之后才可激活的只读钩子");
    expect(WORLD_DIRECTOR_SYSTEM_PROMPT).toContain("不是需要填满的台词配额");
    expect(WORLD_DIRECTOR_SYSTEM_PROMPT).toContain("不得在本幕结果尚未成立时提前展开下一段旅程");
    expect(WORLD_DIRECTOR_SYSTEM_PROMPT).toContain("本次调用使用临时短引用");
    expect(WORLD_DIRECTOR_SYSTEM_PROMPT).toContain("不得使用名称、真实 UUID、UUID 前缀");
  });

  it("keeps Beat planning out of the model tool loop", () => {
    expect(worldDirectorBeatRoundTools(0, true).map((tool) => tool.function.name))
      .toEqual(["retrieve_source"]);
    expect(worldDirectorBeatRoundTools(0, false)).toEqual([]);
    expect(worldDirectorBeatRoundTools(1, true).map((tool) => tool.function.name))
      .toEqual(["plan_beat"]);
  });

  it("projects runtime ids as short references in the Director prompt", () => {
    const ids = {
      actor: "world:actor:zhou-yu",
      context: "world:context:main",
      chapter: "world:chapter:red-cliff",
      beat: "world:beat:opening",
      event: "world:event:arrival",
    };
    const references = createDirectorReferenceTable({
      actorIds: [ids.actor],
      contextIds: [ids.context],
      chapterIds: [ids.chapter],
      beatIds: [ids.beat],
      eventIds: [ids.event],
    });
    const view: WorldDirectorView = {
      worldSummary: `actor=${ids.actor}`,
      actorSummary: `actor=${ids.actor}`,
      contextSummary: `context=${ids.context}`,
      runtimeSummary: `beat=${ids.beat}`,
      chapterSummary: `chapter=${ids.chapter}`,
      recentBeatSummary: ids.beat,
      edgeSummary: ids.beat,
      sourceSummary: "",
      sourceBindings: [],
      eventBatch: [],
      references,
      foregroundChapterId: ids.chapter,
      task: {
        mode: "plan_beat",
        objective: "推进当前章节",
        sourceEventIds: [ids.event],
        requiredToolNames: [],
      },
    };
    const prompt = buildWorldDirectorUserPrompt(view, {});

    expect(prompt).toContain("actor=A1");
    expect(prompt).toContain("context=C1");
    expect(prompt).toContain("chapter=CH1");
    expect(prompt).toContain("beat=B1");
    expect(prompt).toContain("sourceEventRefs: E1");
    for (const id of Object.values(ids)) expect(prompt).not.toContain(id);
  });
});

describe("resolveDirectorToolChoice", () => {
  it("uses auto when the endpoint does not support required tool choice", () => {
    const provider = {
      profile: {
        capabilities: { toolChoice: "auto" },
      },
    } as Parameters<typeof resolveDirectorToolChoice>[0];

    expect(resolveDirectorToolChoice(provider, true)).toBe("auto");
  });

  it("keeps required for providers without a restrictive capability", () => {
    expect(resolveDirectorToolChoice({}, true)).toBe("required");
    expect(resolveDirectorToolChoice({ profile: { capabilities: {} } } as Parameters<typeof resolveDirectorToolChoice>[0], true)).toBe("required");
    expect(resolveDirectorToolChoice({ profile: { capabilities: { toolChoice: "required" } } } as Parameters<typeof resolveDirectorToolChoice>[0], true)).toBe("required");
  });

  it("uses auto for ordinary Director turns", () => {
    expect(resolveDirectorToolChoice({}, false)).toBe("auto");
  });
});
