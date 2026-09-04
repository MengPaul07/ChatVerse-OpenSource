import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldSourceLibraryRecord } from "./worldSourceLibrary";

const groupRecords = new Map<string, { libraryId: string; group: { metadata: { name: string }; characters: unknown[] }; updatedAt: number }>();
const draftRecords = new Map<string, { libraryId: string; draft: { metadata: { name: string }; actors: unknown[]; revision: number }; updatedAt: number }>();
const archiveRecords = new Map<string, { libraryId: string; archive: { metadata: { name: string; actorNames: string[]; eventSequence: number } }; updatedAt: number }>();
const characterRecords = new Map<string, { libraryId: string; character: { name: string; description?: string }; updatedAt: number }>();
const sourceRecords = new Map<string, WorldSourceLibraryRecord>();
const assetRecords = [{ key: "group-1:cover.png", libraryId: "group-1", path: "cover.png", blob: new Blob(["image"]) }];
const visualAssetRecords: unknown[] = [];
const localValues = new Map<string, string>();
const deletedGroups: string[] = [];
const deletedDrafts: string[] = [];
const deletedArchives: string[] = [];
const deletedCharacters: string[] = [];
const deletedSources: string[] = [];
let assetStoreCleared = false;

const request = <T,>(result: T): IDBRequest<T> => {
  const value = { result } as IDBRequest<T> & { onSuccess?: () => void };
  Object.defineProperty(value, "onsuccess", {
    set(handler: () => void) {
      value.onSuccess = handler;
      queueMicrotask(() => value.onSuccess?.());
    },
  });
  return value;
};

vi.mock("./groupLibrary", () => ({
  listLibraryGroups: async () => [...groupRecords.values()],
  deleteLibraryGroup: async (id: string) => { deletedGroups.push(id); groupRecords.delete(id); },
}));
vi.mock("./worldDraftLibrary", () => ({
  listWorldDrafts: async () => [...draftRecords.values()],
  deleteWorldDraft: async (id: string) => { deletedDrafts.push(id); draftRecords.delete(id); },
}));
vi.mock("./worldArchiveLibrary", () => ({
  listWorldArchives: async () => [...archiveRecords.values()],
  deleteWorldArchive: async (id: string) => { deletedArchives.push(id); archiveRecords.delete(id); },
}));
vi.mock("./characterLibrary", () => ({
  listLibraryCharacters: async () => [...characterRecords.values()],
  deleteLibraryCharacter: async (id: string) => { deletedCharacters.push(id); characterRecords.delete(id); },
}));
vi.mock("./worldSourceLibrary", () => ({
  listWorldSources: async () => [...sourceRecords.values()],
  assertWorldSourceCanDelete: async () => undefined,
  deleteWorldSource: async (id: string) => { deletedSources.push(id); sourceRecords.delete(id); },
}));
vi.mock("./providerSettings", () => ({
  clearProviderSettings: vi.fn(),
  readProviderSettings: () => ({ preset: "custom", providerName: "Test", apiKey: "secret", baseURL: "https://example.com", model: "test" }),
}));
vi.mock("./imageProviderSettings", () => ({
  IMAGE_PROVIDER_SETTINGS_STORAGE_KEY: "chatverse:image-provider-settings:v1",
  clearImageProviderSettings: vi.fn(),
  readImageProviderSettings: () => ({ preset: "openai", protocol: "openai", providerName: "OpenAI", apiKey: "image-secret", baseURL: "https://api.openai.com/v1", model: "gpt-image-1", landscapeSize: "1536x1024", portraitSize: "1024x1536" }),
}));
vi.mock("./localLibraryDatabase", () => ({
  GROUP_ASSET_STORE: "assets",
  VISUAL_ASSET_STORE: "visual-assets",
  openLibraryDatabase: async () => {
    const transaction = {
      oncomplete: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined,
      objectStore: (storeName: string) => ({
        getAll: () => request(storeName === "visual-assets" ? visualAssetRecords : assetRecords),
        clear: () => {
          assetStoreCleared = true;
          queueMicrotask(() => transaction.oncomplete?.());
        },
      }),
    };
    return { transaction: () => transaction };
  },
}));

import {
  clearChatVerseStorage,
  createWorldSourceCategory,
  deleteStorageItem,
  getLocalStorageInventory,
  isManagedLocalStorageKey,
} from "./storageManagement";

function sourceRecord(
  libraryId: string,
  name: string,
  revision: number,
  updatedAt: number,
  documentCount: number,
  chunkCount: number,
): WorldSourceLibraryRecord {
  return {
    libraryId,
    createdAt: updatedAt - 100,
    updatedAt,
    bundle: {
      schemaVersion: 1,
      id: `source:${libraryId}`,
      revision,
      metadata: { name },
      documents: Array.from({ length: documentCount }, () => ({})),
      sections: [],
      chunks: Array.from({ length: chunkCount }, () => ({})),
      index: {},
    },
  } as unknown as WorldSourceLibraryRecord;
}

describe("storageManagement", () => {
  beforeEach(() => {
    groupRecords.clear();
    draftRecords.clear();
    archiveRecords.clear();
    characterRecords.clear();
    sourceRecords.clear();
    deletedGroups.length = 0;
    deletedDrafts.length = 0;
    deletedArchives.length = 0;
    deletedCharacters.length = 0;
    deletedSources.length = 0;
    assetStoreCleared = false;
    localValues.clear();
    vi.stubGlobal("window", {
      localStorage: {
        get length() { return localValues.size; },
        key: (index: number) => [...localValues.keys()][index] ?? null,
        getItem: (key: string) => localValues.get(key) ?? null,
        setItem: (key: string, value: string) => localValues.set(key, value),
        removeItem: (key: string) => localValues.delete(key),
      },
    });
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 1024, quota: 4096 }) } });
  });

  it("只统计 ChatVerse 数据，不触碰其他 localStorage 键", async () => {
    groupRecords.set("group-1", { libraryId: "group-1", group: { metadata: { name: "工作群" }, characters: [{}] }, updatedAt: 100 });
    localValues.set("chatverse:world:room-id", "room-1");
    localValues.set("cv_groups_v2", "unmanaged-old-data");
    localValues.set("other-app:theme", "dark");

    const inventory = await getLocalStorageInventory();
    const runtime = inventory.categories.find((category) => category.id === "runtime");

    expect(runtime?.count).toBe(1);
    expect(inventory.categories.map((category) => String(category.id))).not.toContain("legacy");
    expect(inventory.categories.find((category) => category.id === "groups")?.count).toBe(1);
    expect(inventory.categories.find((category) => category.id === "world-sources")?.count).toBe(0);
    expect(localValues.has("other-app:theme")).toBe(true);
    expect(isManagedLocalStorageKey("other-app:theme")).toBe(false);
    expect(isManagedLocalStorageKey("cv_groups_v2")).toBe(false);
  });

  it("清空本机数据会清理关联库，但保留其他应用数据", async () => {
    groupRecords.set("group-1", { libraryId: "group-1", group: { metadata: { name: "工作群" }, characters: [] }, updatedAt: 100 });
    draftRecords.set("draft-1", { libraryId: "draft-1", draft: { metadata: { name: "草稿" }, actors: [], revision: 1 }, updatedAt: 100 });
    archiveRecords.set("archive-1", { libraryId: "archive-1", archive: { metadata: { name: "世界", actorNames: [], eventSequence: 2 } }, updatedAt: 100 });
    characterRecords.set("character-1", { libraryId: "character-1", character: { name: "角色" }, updatedAt: 100 });
    sourceRecords.set("source-1", sourceRecord("source-1", "资料", 1, 100, 1, 2));
    localValues.set("chatverse:group-world:group-1:room-id", "room-1");
    localValues.set("chatverse:provider-settings", "secret");
    localValues.set("chatverse:image-provider-settings:v1", "image-secret");
    localValues.set("other-app:theme", "dark");

    await clearChatVerseStorage();

    expect(deletedGroups).toEqual(["group-1"]);
    expect(deletedDrafts).toEqual(["draft-1"]);
    expect(deletedArchives).toEqual(["archive-1"]);
    expect(deletedCharacters).toEqual(["character-1"]);
    expect(deletedSources).toEqual(["source-1"]);
    expect(assetStoreCleared).toBe(true);
    expect(localValues.has("other-app:theme")).toBe(true);
    expect(localValues.has("chatverse:provider-settings")).toBe(false);
    expect(localValues.has("chatverse:image-provider-settings:v1")).toBe(false);
  });

  it("删除会话指针时不会接受未命名空间的键", async () => {
    localValues.set("chatverse:world:room-id", "room-1");
    localValues.set("other-app:room-id", "room-2");

    await deleteStorageItem("runtime", "other-app:room-id");

    expect(localValues.has("chatverse:world:room-id")).toBe(true);
    expect(localValues.has("other-app:room-id")).toBe(true);
  });

  it("展示资料源的 revision、文档数、片段数、更新时间和近似大小", () => {
    const category = createWorldSourceCategory([
      sourceRecord("older", "旧资料", 2, 100, 1, 4),
      sourceRecord("newer", "新资料", 3, 200, 2, 9),
    ]);

    expect(category.id).toBe("world-sources");
    expect(category.label).toBe("世界资料源");
    expect(category.count).toBe(2);
    expect(category.canClear).toBe(true);
    expect(category.items.map((item) => item.id)).toEqual(["newer", "older"]);
    expect(category.items[0]?.name).toBe("新资料");
    expect(category.items[0]?.detail).toContain("revision 3");
    expect(category.items[0]?.detail).toContain("2 篇文档");
    expect(category.items[0]?.detail).toContain("9 个片段");
    expect(category.items[0]?.updatedAt).toBe(200);
    expect(category.items[0]?.bytes).toBeGreaterThan(0);
  });

  it("删除资料源和清空资料源分类都按本地 libraryId 执行", async () => {
    sourceRecords.set("source-a", sourceRecord("source-a", "甲", 1, 100, 1, 1));
    sourceRecords.set("source-b", sourceRecord("source-b", "乙", 1, 200, 1, 1));

    await deleteStorageItem("world-sources", "source-a");

    expect(deletedSources).toEqual(["source-a"]);
    await deleteStorageItem("world-sources", "source-b");
    expect(deletedSources).toEqual(["source-a", "source-b"]);
  });
});
