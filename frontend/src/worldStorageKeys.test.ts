import { describe, expect, it } from "vitest";
import {
  groupWorldRoomStorageKey,
  linkedArchiveStorageKey,
  worldArchiveRoomStorageKey,
  worldRoomStorageKey,
} from "./worldStorageKeys";

describe("world storage keys", () => {
  it("derives one archive pointer from the exact room pointer", () => {
    const roomKey = groupWorldRoomStorageKey("group-1");

    expect(roomKey).toBe("chatverse:group-world:group-1:room-id");
    expect(linkedArchiveStorageKey(roomKey)).toBe(
      "chatverse:group-world:group-1:room-id:archive-id",
    );
  });

  it("keeps world and archive room namespaces distinct", () => {
    expect(worldRoomStorageKey("world-1")).toBe("chatverse:world:world-1:room-id");
    expect(worldArchiveRoomStorageKey("archive-1")).toBe(
      "chatverse:world-archive:archive-1:room-id",
    );
  });
});
