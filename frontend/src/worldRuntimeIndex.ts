import { useCallback, useEffect, useState } from "react";
import { providerRequestHeaders } from "./providerSettings";
import type { WorldArchiveRecord } from "./worldArchiveLibrary";
import type { WorldView } from "./world/types";

export interface WorldRuntimeEntry {
  archiveId: string;
  worldId: string;
  roomId: string;
  status: WorldView["world"]["status"] | "unavailable";
  autoPauseDueAt?: number;
  autoPausedAt?: number;
  viewerCount: number;
  checkedAt: number;
}

export function useWorldRuntimeIndex(records: readonly WorldArchiveRecord[]) {
  const [entries, setEntries] = useState<Map<string, WorldRuntimeEntry>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setEntries(await loadWorldRuntimeIndex(records));
    } finally {
      setRefreshing(false);
    }
  }, [records]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return { entries, refreshing, refresh };
}

async function loadWorldRuntimeIndex(
  records: readonly WorldArchiveRecord[],
): Promise<Map<string, WorldRuntimeEntry>> {
  const results = await Promise.all(records.map(async (record) => {
    if (!record.lastRoomId) return undefined;
    const base = {
      archiveId: record.libraryId,
      worldId: record.archive.worldId,
      roomId: record.lastRoomId,
      viewerCount: 0,
      checkedAt: Date.now(),
    };
    try {
      const response = await fetch(`/api/v1/worlds/${encodeURIComponent(record.lastRoomId)}`, {
        headers: providerRequestHeaders(),
      });
      if (!response.ok) return { ...base, status: "unavailable" as const };
      const body = await response.json() as { view?: WorldView };
      const view = body.view;
      if (!view || view.world.id !== record.archive.worldId) {
        return { ...base, status: "unavailable" as const };
      }
      return {
        ...base,
        status: view.world.status,
        viewerCount: view.runtime.room.viewerCount,
        autoPauseDueAt: view.runtime.room.autoPauseDueAt,
        autoPausedAt: view.runtime.room.autoPausedAt,
      };
    } catch {
      return { ...base, status: "unavailable" as const };
    }
  }));
  const entries = new Map<string, WorldRuntimeEntry>();
  for (const entry of results) {
    if (entry) entries.set(entry.archiveId, entry);
  }
  return entries;
}
