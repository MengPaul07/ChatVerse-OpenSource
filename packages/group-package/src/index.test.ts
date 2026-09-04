import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createGroupPackageArchive, decodeGroupPackageArchive, GroupPackageError } from "./index.js";

const group = {
  kind: "chatverse.group" as const,
  schemaVersion: 1 as const,
  metadata: { id: "source-group", name: "测试群", avatar: "asset://avatars/a.png" },
  scene: { groupName: "测试群", topic: "测试", atmosphere: "自然" },
  characters: [],
  userProfiles: [{ name: "测试用户", card: "群成员" }],
  relations: { relations: [{ from: "测试用户", to: "测试用户", description: "自我" }] },
  runtime: { pacing: { multiplier: 2 } },
};

describe("group package codec", () => {
  it("round-trips a group and its assets", () => {
    const archive = createGroupPackageArchive(group, [{ path: "avatars/a.png", bytes: new Uint8Array([1, 2, 3]) }]);
    const decoded = decodeGroupPackageArchive(archive);

    expect(decoded.group.metadata.id).toBe("source-group");
    expect(decoded.group.schemaVersion).toBe(1);
    expect(decoded.group.userProfiles?.[0]?.name).toBe("测试用户");
    expect(decoded.group.runtime?.pacing?.multiplier).toBe(2);
    expect(decoded.assets[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a missing referenced asset", () => {
    expect(() => createGroupPackageArchive(group)).toThrow(GroupPackageError);
  });

  it("refuses unsafe archive paths", () => {
    const archive = zipSync({
      "test.chatverse/group.json": strToU8(JSON.stringify({ ...group, metadata: { ...group.metadata, avatar: undefined } })),
      "../outside.txt": strToU8("unsafe"),
    });
    expect(() => decodeGroupPackageArchive(archive)).toThrow("Unsafe package path");
  });

  it("refuses unsupported schema versions", () => {
    const archive = zipSync({
      "test.chatverse/group.json": strToU8(JSON.stringify({ ...group, schemaVersion: 99, metadata: { ...group.metadata, avatar: undefined } })),
    });
    expect(() => decodeGroupPackageArchive(archive)).toThrow("Unsupported group schemaVersion");
  });

  it("enforces archive size limits", () => {
    const archive = createGroupPackageArchive(group, [{ path: "avatars/a.png", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(() => decodeGroupPackageArchive(archive, {
      maxArchiveBytes: 1,
      maxJsonBytes: 1,
      maxAssetBytes: 1,
      maxAssets: 0,
      maxExpandedBytes: 1,
    })).toThrow("Group package is too large");
  });
});
