import { describe, expect, it } from "vitest";
import { createDirectorReferenceTable } from "./references.js";

describe("DirectorReferenceTable", () => {
  const table = createDirectorReferenceTable({
    actorIds: ["world:actor:zhou-yu", "world:player:main"],
    contextIds: ["world:context:main"],
    chapterIds: ["chapter:red-cliff"],
    beatIds: ["beat:opening"],
    eventIds: ["event:one", "event:two"],
    sourceIds: ["source:archive"],
  });

  it("assigns deterministic typed aliases and resolves only exact aliases", () => {
    expect(table.refFor("actor", "world:actor:zhou-yu")).toBe("A1");
    expect(table.refFor("actor", "world:player:main")).toBe("A2");
    expect(table.refFor("context", "world:context:main")).toBe("C1");
    expect(table.refFor("chapter", "chapter:red-cliff")).toBe("CH1");
    expect(table.refFor("beat", "beat:opening")).toBe("B1");
    expect(table.refFor("event", "event:one")).toBe("E1");
    expect(table.resolve("actor", "A1")).toBe("world:actor:zhou-yu");
    expect(table.resolve("actor", "a1")).toBeUndefined();
    expect(table.resolve("actor", "zhou-yu")).toBeUndefined();
    expect(table.resolve("actor", "world:actor:zhou-yu")).toBeUndefined();
    expect(table.resolve("actor", "C1")).toBeUndefined();
  });

  it("keeps source chunk aliases stable and redacts known ids", () => {
    expect(table.registerSourceChunks("source:archive", ["chunk:1", "chunk:2"])).toEqual(["S1-1", "S1-2"]);
    expect(table.registerSourceChunks("source:archive", ["chunk:2", "chunk:1"])).toEqual(["S1-2", "S1-1"]);
    expect(table.redactKnownIds("world:actor:zhou-yu in chunk:1 from source:archive")).toBe("A1 in S1-1 from S1");
    expect(table.redactModelOutput("world:actor:zhou-yu in world:old-id")).toBe("<internal-id> in <internal-id>");
  });

  it("exposes real ids only through the debug mapping", () => {
    expect(table.debugMapping()).toMatchObject({
      actors: { A1: "world:actor:zhou-yu" },
      contexts: { C1: "world:context:main" },
    });
  });

  it("does not rewrite semantic labels when an id happens to be plain text", () => {
    const plainIdTable = createDirectorReferenceTable({
      actorIds: ["player"],
      contextIds: ["main"],
      chapterIds: [],
      beatIds: [],
      eventIds: [],
    });
    expect(plainIdTable.redactKnownIds(
      "player (player) participantKind=player actor=player actors=[player] context=main",
    )).toBe("player (player) participantKind=player actor=A1 actors=[A1] context=C1");
  });
});
