import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorldDraft } from "@chatverse/world-authoring";

const records = new Map<string, unknown>();

vi.mock("./localLibraryDatabase", () => ({
  WORLD_DRAFT_STORE: "world-drafts",
  openLibraryDatabase: async () => ({
    transaction: () => ({
      objectStore: () => ({
        getAll: () => request([...records.values()]),
        get: (id: string) => request(records.get(id)),
        put: (value: { libraryId: string }) => {
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
  createWorldDraft,
  deleteWorldDraft,
  getWorldDraft,
  listWorldDrafts,
  updateWorldDraft,
} from "./worldDraftLibrary";

describe("worldDraftLibrary", () => {
  beforeEach(() => records.clear());

  it("persists and updates independent draft records", async () => {
    const draft = createEmptyWorldDraft({ id: "world:local", name: "本地世界" });
    const created = await createWorldDraft(draft);
    expect((await listWorldDrafts()).length).toBe(1);

    const next = { ...draft, revision: 1, premise: "新的前提" };
    await updateWorldDraft(created.libraryId, next);
    expect((await getWorldDraft(created.libraryId))?.draft.premise).toBe("新的前提");
  });

  it("keeps the source template identity for duplicate creation warnings", async () => {
    const draft = createEmptyWorldDraft({ id: "world:template:one", name: "模板世界" });
    const created = await createWorldDraft(draft, undefined, "template");

    expect((await getWorldDraft(created.libraryId))?.sourceTemplateId).toBe("template");
  });

  it("deletes a draft without affecting other records", async () => {
    const first = await createWorldDraft(createEmptyWorldDraft({ id: "world:first", name: "第一个" }));
    const second = await createWorldDraft(createEmptyWorldDraft({ id: "world:second", name: "第二个" }));

    await deleteWorldDraft(first.libraryId);

    expect(await getWorldDraft(first.libraryId)).toBeUndefined();
    expect((await getWorldDraft(second.libraryId))?.draft.metadata.name).toBe("第二个");
  });
});

function request<T>(result: T): IDBRequest<T> {
  const value = { result } as IDBRequest<T>;
  queueMicrotask(() => value.onsuccess?.(new Event("success")));
  return value;
}
