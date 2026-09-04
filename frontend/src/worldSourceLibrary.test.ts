import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileWorldSourceBundle } from "@chatverse/world-source";

const records = new Map<string, unknown>();
const draftReferences: unknown[] = [];
const archiveReferences: unknown[] = [];

vi.mock("./worldDraftLibrary", () => ({
  listWorldDrafts: async () => structuredClone(draftReferences),
}));

vi.mock("./worldArchiveLibrary", () => ({
  listWorldArchives: async () => structuredClone(archiveReferences),
}));

vi.mock("./localLibraryDatabase", () => ({
  WORLD_SOURCE_STORE: "world-sources",
  openLibraryDatabase: async () => ({
    transaction: () => ({
      objectStore: () => ({
        getAll: () => request([...records.values()]),
        get: (id: string) => request(records.get(id)),
        add: (value: { libraryId: string }) => {
          if (records.has(value.libraryId)) return failedRequest(new DOMException("duplicate", "ConstraintError"));
          records.set(value.libraryId, structuredClone(value));
          return request(value);
        },
        delete: (id: string) => {
          records.delete(id);
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
  deleteWorldSource,
  importWorldSourceFiles,
  listWorldSources,
  loadBoundWorldSourceBundles,
  loadWorldSourceMaterials,
  materializeArchitectSourceArtifact,
  reviseArchitectWorldSource,
  saveWorldSourceBundle,
} from "./worldSourceLibrary";

describe("worldSourceLibrary", () => {
  beforeEach(() => {
    records.clear();
    draftReferences.length = 0;
    archiveReferences.length = 0;
  });

  it("imports Markdown and text files as one immutable bundle", async () => {
    const record = await importWorldSourceFiles([
      new File(["# 第一章\n\n山门在雨中打开。"], "world.md", { type: "text/markdown" }),
      new File(["附录中的约束。"], "notes.txt", { type: "text/plain" }),
    ], { name: "雨山设定" });

    expect(record.bundle.metadata.name).toBe("雨山设定");
    expect(record.bundle.documents).toHaveLength(2);
    expect(record.bundle.sections.length).toBeGreaterThan(0);
    expect(record.bundle.chunks.length).toBeGreaterThan(0);
    expect(await listWorldSources()).toHaveLength(1);
  });

  it("returns an existing identical revision and rejects conflicting contents", async () => {
    const first = bundle("source:fixed", 2, "第一版");
    const saved = await saveWorldSourceBundle(first);
    const repeated = await saveWorldSourceBundle(structuredClone(first));

    expect(repeated.libraryId).toBe(saved.libraryId);
    expect(saved.libraryId).toBe("source:fixed@2");
    await expect(saveWorldSourceBundle(bundle("source:fixed", 2, "冲突内容")))
      .rejects.toThrow("内容不同");
  });

  it("allows only one concurrent writer for the same bundle revision", async () => {
    const results = await Promise.allSettled([
      saveWorldSourceBundle(bundle("source:race", 1, "甲")),
      saveWorldSourceBundle(bundle("source:race", 1, "乙")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await listWorldSources()).toHaveLength(1);
  });

  it("loads bound revisions in binding order and reports missing local sources", async () => {
    await saveWorldSourceBundle(bundle("source:a", 1, "甲"));
    await saveWorldSourceBundle(bundle("source:b", 3, "乙"));

    const loaded = await loadBoundWorldSourceBundles([
      { bundleId: "source:b", revision: 3, fidelity: "strict" },
      { bundleId: "source:a", revision: 1, fidelity: "reference" },
    ]);
    expect(loaded.map((item) => item.id)).toEqual(["source:b", "source:a"]);

    await expect(loadBoundWorldSourceBundles([
      { bundleId: "source:missing", revision: 1, fidelity: "free" },
    ])).rejects.toThrow("本机缺少已绑定资料源");
  });

  it("deletes only the selected local source record", async () => {
    const first = await saveWorldSourceBundle(bundle("source:first", 1, "一"));
    await saveWorldSourceBundle(bundle("source:second", 1, "二"));

    await deleteWorldSource(first.libraryId);

    expect((await listWorldSources()).map((record) => record.bundle.id))
      .toEqual(["source:second"]);
  });

  it("protects revisions still referenced by drafts or archives", async () => {
    const record = await saveWorldSourceBundle(bundle("source:bound", 1, "正文"));
    draftReferences.push({
      draft: {
        metadata: { name: "引用草稿" },
        sources: [{ bundleId: "source:bound", revision: 1, fidelity: "strict" }],
      },
    });

    await expect(deleteWorldSource(record.libraryId)).rejects.toThrow("引用草稿");
    expect(await listWorldSources()).toHaveLength(1);
  });

  it("keeps imported originals read-only and revisions Architect Markdown", async () => {
    const imported = await saveWorldSourceBundle(bundle("source:original", 1, "原文"));
    await expect(reviseArchitectWorldSource(imported, [{ path: "source.md", content: "# 改写" }]))
      .rejects.toThrow("原始文档不可修改");

    const created = await materializeArchitectSourceArtifact({
      id: "artifact:1",
      mode: "create",
      bundleId: "source:architect",
      revision: 1,
      name: "世界索引",
      documents: [{ path: "index.md", title: "索引", content: "# 索引\n\n第一版。" }],
    });
    const revised = await reviseArchitectWorldSource(created, [{
      path: "index.md",
      title: "索引",
      content: "# 索引\n\n第二版。",
    }]);
    expect(created.origin).toBe("architect");
    expect(revised.bundle.revision).toBe(2);
    expect(await listWorldSources()).toHaveLength(3);

    const materials = await loadWorldSourceMaterials([
      { bundleId: "source:original", revision: 1, fidelity: "reference" },
      { bundleId: "source:architect", revision: 2, fidelity: "reference" },
    ]);
    expect(materials.map((material) => material.origin)).toEqual(["user_import", "architect"]);
  });
});

function bundle(id: string, revision: number, content: string) {
  return compileWorldSourceBundle({
    id,
    revision,
    name: id,
    documents: [{ path: "source.md", content: `# 标题\n\n${content}` }],
  });
}

function request<T>(result: T): IDBRequest<T> {
  const value = { result } as IDBRequest<T>;
  queueMicrotask(() => value.onsuccess?.(new Event("success")));
  return value;
}

function failedRequest<T>(error: DOMException): IDBRequest<T> {
  const value = { error } as IDBRequest<T>;
  queueMicrotask(() => value.onerror?.(new Event("error")));
  return value;
}
