import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldArchive } from "@chatverse/core";

const records = new Map<string, unknown>();
const visualRecords = new Map<string, { id: string; archiveId?: string }>();

vi.mock("./localLibraryDatabase", () => ({
  WORLD_ARCHIVE_STORE: "world-archives",
  VISUAL_ASSET_STORE: "visual-assets",
  openLibraryDatabase: async () => ({
    transaction: () => ({
      objectStore: (name: string) => ({
        getAll: () => request(name === "visual-assets" ? [...visualRecords.values()] : [...records.values()]),
        get: (id: string) => request(records.get(id)),
        put: (value: { libraryId: string }) => {
          records.set(value.libraryId, structuredClone(value));
          return request(value);
        },
        delete: (id: string) => {
          (name === "visual-assets" ? visualRecords : records).delete(id);
          return request(undefined);
        },
      }),
      set oncomplete(handler: (() => void) | null) {
        if (handler) queueMicrotask(handler);
      },
      onerror: null,
      onabort: null,
    }),
  }),
}));

import {
  deleteWorldArchive,
  getWorldArchive,
  latestWorldArchives,
  listWorldArchives,
  saveWorldArchive,
  type WorldArchiveRecord,
} from "./worldArchiveLibrary";

describe("worldArchiveLibrary", () => {
  beforeEach(() => { records.clear(); visualRecords.clear(); });

  it("upserts one stable local record as the same world advances", async () => {
    const first = archive(20);
    first.metadata.coverImage = "/world-covers/test.webp";
    await saveWorldArchive(first, "room-a", {
      kind: "world_draft",
      draftLibraryId: "draft:test",
      draftRevision: 3,
    });
    const second = archive(40);
    await saveWorldArchive(second, "room-b");

    const values = await listWorldArchives();
    expect(values).toHaveLength(1);
    expect(values[0]?.libraryId).toBe("archive:test");
    expect(values[0]?.archive.snapshot.eventSequence).toBe(40);
    expect(values[0]?.lastRoomId).toBe("room-b");
    expect((await getWorldArchive("archive:test"))?.archive.metadata.eventSequence)
      .toBe(40);
    expect((await getWorldArchive("archive:test"))?.source?.draftLibraryId)
      .toBe("draft:test");
    expect((await getWorldArchive("archive:test"))?.archive.metadata.coverImage)
      .toBe("/world-covers/test.webp");

    await deleteWorldArchive("archive:test");
    expect(await listWorldArchives()).toEqual([]);
  });

  it("keeps only the latest playable save per world for library views", () => {
    const older = record(20, "archive:old", 10, "world:old");
    const newer = record(40, "archive:new", 20, "world:new");

    expect(latestWorldArchives([older, newer]).map((item) => item.libraryId))
      .toEqual(["archive:new"]);
  });
});

function record(eventSequence: number, archiveId: string, updatedAt: number, worldId = "world:test"): WorldArchiveRecord {
  const value = archive(eventSequence, archiveId, worldId);
  return {
    libraryId: archiveId,
    archive: value,
    createdAt: 1,
    updatedAt,
  };
}

function archive(eventSequence: number, archiveId = "archive:test", worldId = "world:test"): WorldArchive {
  return {
    schemaVersion: 1,
    archiveId,
    worldId,
    definition: {
      metadata: { id: worldId, name: "测试世界" },
      actors: [],
      contexts: [],
    },
    snapshot: {
      schemaVersion: 7,
      worldId,
      worldTime: 100,
      eventSequence,
      events: [],
      actorStates: [],
      actorBackgrounds: [],
      actorControls: [],
      dynamicActors: [],
      dynamicRelations: [],
      actorMemories: [],
      actorMemoryRuntime: [],
      presences: [],
      contexts: [],
      contextSessions: [],
      narrative: { beats: [], edges: [], chapters: [] },
      directorCursor: eventSequence,
      timestamp: 100,
    },
    metadata: {
      name: "测试世界",
      createdAt: 1,
      updatedAt: 2,
      eventSequence,
      worldTime: 100,
      lastStatus: "running",
      actorNames: [],
      activeChapterTitles: [],
    },
  };
}

function request<T>(result: T): IDBRequest<T> {
  const value = { result } as IDBRequest<T>;
  queueMicrotask(() => value.onsuccess?.(new Event("success")));
  return value;
}
