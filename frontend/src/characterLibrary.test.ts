import { describe, expect, it } from "vitest";
import {
  createWorldActorFromCharacter,
  decodeCharacterPackage,
  exportCharacterPackage,
} from "./characterLibrary";

describe("character package", () => {
  it("round-trips a portable character card", () => {
    const source = {
      name: "鹿目圆",
      description: "见泷原中学二年级学生",
      personality: "温柔、坚定",
      scenario: "候选魔法少女",
      messageExample: "【鹿目圆】：我会努力的。",
      instructions: "关心群成员。",
    };
    const exported = exportCharacterPackage(source);
    const restored = decodeCharacterPackage(exported.contents);

    expect(exported.fileName).toBe("鹿目圆.chatverse-character.json");
    expect(restored).toEqual(source);
  });

  it("rejects files that are not ChatVerse character cards", () => {
    expect(() => decodeCharacterPackage(JSON.stringify({ name: "not a package" }))).toThrow("这不是支持的 ChatVerse 角色卡文件。");
  });

  it("creates an independent world Actor identity from a reusable card", () => {
    const source = {
      name: "巴麻美",
      description: "见泷原中学三年级学生",
      personality: "从容",
      scenario: "",
      messageExample: "",
    };
    const first = createWorldActorFromCharacter(source);
    const second = createWorldActorFromCharacter(source);

    expect(first).toMatchObject({
      kind: "character",
      card: source,
    });
    expect(first.id).not.toBe(second.id);
    expect(first.card).not.toBe(source);
  });
});
