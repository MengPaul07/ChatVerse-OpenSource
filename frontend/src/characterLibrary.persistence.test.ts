import { beforeEach, describe, expect, it, vi } from "vitest";

const records = new Map<string, unknown>();
vi.mock("./localLibraryDatabase", () => ({
  CHARACTER_LIBRARY_STORE: "characters",
  openLibraryDatabase: async () => ({
    transaction: () => ({
      objectStore: () => ({
        getAll: () => request(structuredClone([...records.values()])),
        get: (id: string) => request(structuredClone(records.get(id))),
        put: (value: { libraryId: string }) => {
          records.set(value.libraryId, structuredClone(value));
          return request(value);
        },
      }),
      set oncomplete(handler: (() => void) | null) { if (handler) queueMicrotask(handler); },
      onerror: null,
      onabort: null,
    }),
  }),
}));

import {
  createLibraryCharacter, updateLibraryCharacter, listLibraryCharacters,
  exportCharacterPackage, decodeCharacterPackage, createWorldActorFromCharacter,
} from "./characterLibrary";

describe("character library persistence", () => {
  beforeEach(() => records.clear());

  it("retains the full card and portrait across saves, rereads, export and import", async () => {
    const source = {
      name: "记录员", description: "档案室成员", personality: "细心", scenario: "", messageExample: "",
      visual: { appearance: "圆框眼镜", portraitAssetId: "portrait-1", portraitPrompt: "眼镜与长衫" },
    };
    const created = await createLibraryCharacter(source);
    source.visual.appearance = "外部改动";
    expect((await listLibraryCharacters())[0]!.character.visual!.appearance).toBe("圆框眼镜");
    await updateLibraryCharacter(created.libraryId, { ...created.character, name: "新记录员" });
    const reloaded = (await listLibraryCharacters())[0]!;
    expect(reloaded.character).toEqual({ ...created.character, name: "新记录员" });
    const portable = decodeCharacterPackage(exportCharacterPackage(reloaded.character).contents);
    expect(portable).toEqual(reloaded.character);
    const actor = createWorldActorFromCharacter(portable);
    expect(actor.card.visual).toEqual(reloaded.character.visual);
    actor.card.visual!.appearance = "世界内改动";
    expect((await listLibraryCharacters())[0]!.character.visual!.appearance).toBe("圆框眼镜");
  });
});

function request<T>(result: T): IDBRequest<T> {
  const value = { result } as IDBRequest<T>;
  queueMicrotask(() => value.onsuccess?.(new Event("success")));
  return value;
}
