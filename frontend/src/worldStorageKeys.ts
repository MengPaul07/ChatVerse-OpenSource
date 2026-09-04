export const DEFAULT_WORLD_ROOM_STORAGE_KEY = "chatverse:world:room-id";

export function groupWorldRoomStorageKey(groupId: string): string {
  return `chatverse:group-world:${groupId}:room-id`;
}

export function worldArchiveRoomStorageKey(archiveId: string): string {
  return `chatverse:world-archive:${archiveId}:room-id`;
}

export function worldRoomStorageKey(worldId: string): string {
  return `chatverse:world:${worldId}:room-id`;
}

export function linkedArchiveStorageKey(roomStorageKey: string): string {
  return `${roomStorageKey}:archive-id`;
}
