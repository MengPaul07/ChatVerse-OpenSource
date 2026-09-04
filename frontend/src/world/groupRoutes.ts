import type { GroupCard } from "@chatverse/core";

export interface GroupWorldIdentity {
  worldId: string;
  contextId: string;
}

/** Resolve the stable World/Context identity used by every Group entry point. */
export function groupWorldIdentity(group: GroupCard): GroupWorldIdentity {
  const worldId = group.worldRef?.worldId.trim()
    || group.metadata.id?.trim()
    || `group:${slugify(group.metadata.name)}`;
  return {
    worldId,
    contextId: group.worldRef?.contextId.trim() || `${worldId}:context:main`,
  };
}

export function groupWorldManagePath(groupId: string, group: GroupCard): string {
  const identity = groupWorldIdentity(group);
  return `/worlds/${encodeURIComponent(identity.worldId)}/manage?groupId=${encodeURIComponent(groupId)}&context=${encodeURIComponent(identity.contextId)}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, "")
    .replace(/-+/g, "-");
  return slug || "world";
}
