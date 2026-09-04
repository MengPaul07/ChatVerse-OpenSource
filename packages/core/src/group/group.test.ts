import { describe, expect, it } from "vitest";
import type { CharacterCard } from "../contracts/chat.js";
import { defineGroupCard } from "./index.js";
import { groupCardFromWorldDefinition } from "./from-world.js";
import { worldDefinitionFromGroup } from "./to-world.js";

describe("defineGroupCard", () => {
  it("normalizes missing user profiles", () => {
    const card = defineGroupCard({
      metadata: { name: "Test Group" },
      scene: {
        groupName: "Test Group",
        topic: "Daily chat",
        atmosphere: "casual",
      },
      characters: [],
    });

    expect(card.kind).toBe("chatverse.group");
    expect(card.schemaVersion).toBe(1);
    expect(card.userProfiles?.[0]?.name).toBe("你");
    expect(card.userProfiles?.[0]?.card).toBe("群聊成员");
  });

  it("rejects incomplete character cards instead of inventing missing semantics", () => {
    expect(() => defineGroupCard({
      metadata: { name: "Test Group" },
      scene: {
        groupName: "Test Group",
        topic: "Daily chat",
        atmosphere: "casual",
      },
      characters: [{ name: "Alice" } as never],
    })).toThrow("characters[0].description");
  });

  it("uses one relation graph shape", () => {
    const card = defineGroupCard({
      metadata: { name: "Test Group" },
      scene: {
        groupName: "Test Group",
        topic: "Daily chat",
        atmosphere: "casual",
      },
      characters: [],
      relations: { relations: [
        { from: "Alice", to: "Bob", description: "friends" },
      ] },
    });

    expect(card.relations?.relations).toEqual([
      { from: "Alice", to: "Bob", description: "friends" },
    ]);
  });
});

describe("Group and World conversion", () => {
  it("keeps an attached group bound to its World and Context", () => {
    const world = worldDefinitionFromGroup({
      kind: "chatverse.group",
      schemaVersion: 1,
      metadata: { id: "world:archive", name: "夜班档案室" },
      worldRef: { worldId: "world:archive", contextId: "world:archive:context:main" },
      scene: { groupName: "夜班档案室", topic: "异常档案", atmosphere: "安静" },
      characters: [character("林岑")],
    });

    expect(world.metadata.id).toBe("world:archive");
    expect(world.contexts[0]?.id).toBe("world:archive:context:main");
  });

  it("compiles every standalone group as an autonomous Harness context", () => {
    const world = worldDefinitionFromGroup({
      kind: "chatverse.group",
      schemaVersion: 1,
      metadata: { name: "可推进的群聊" },
      scene: { groupName: "可推进的群聊", topic: "一段会继续发展的故事", atmosphere: "自然" },
      characters: [character("林岑")],
    });

    expect(world.directorPolicy?.enabled).toBe(false);
    expect(world.actorMemoryPolicy?.enabled).toBe(false);
    expect(world.contexts[0]?.runtime?.actorRuntime).toEqual({
      activation: "autonomous_idle",
      playerRouting: "focus_actor",
      ambient: "off",
    });
    expect(world.contexts[0]?.conversationMode).toBe("group");
  });

  it("materializes one World chat context as a GroupCard view", () => {
    const group = groupCardFromWorldDefinition({
      metadata: { id: "world:archive", name: "夜班档案室", description: "一个夜间档案世界。" },
      actors: [
        { id: "lin", kind: "character", card: {
          name: "林岑", description: "整理员", personality: "谨慎", scenario: "值夜", messageExample: ""
        } },
        { id: "player", kind: "character", playerControlled: true, card: {
          name: "你", description: "观察者", personality: "由用户决定", scenario: "正在群聊中", messageExample: ""
        } },
      ],
      contexts: [{
        id: "archive-room",
        kind: "chat",
        name: "档案室",
        actorIds: ["lin", "player"],
        scene: { groupName: "档案室", topic: "异常档案", atmosphere: "安静" },
      }],
      relations: [],
      directorPolicy: { enabled: true },
    });

    expect(group.worldRef).toEqual({ worldId: "world:archive", contextId: "archive-room" });
    expect(group.characters.map((actor) => actor.name)).toEqual(["林岑"]);
    expect(group.userProfiles?.[0]?.name).toBe("你");
    expect(worldDefinitionFromGroup(group).directorPolicy?.enabled).toBe(false);
  });
});

function character(name: string): CharacterCard {
  return {
    name,
    description: "档案整理员",
    personality: "谨慎",
    scenario: "正在值夜",
    messageExample: "",
  };
}
