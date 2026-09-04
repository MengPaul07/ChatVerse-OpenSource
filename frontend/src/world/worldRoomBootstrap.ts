import type { Dispatch, MutableRefObject } from "react";
import type { GroupCard } from "@chatverse/core";
import {
  getWorldArchive,
  listWorldArchives,
  saveWorldArchive,
} from "../worldArchiveLibrary";
import { loadBoundWorldSourceBundles } from "../worldSourceLibrary";
import {
  DEFAULT_WORLD_ROOM_STORAGE_KEY,
  worldRoomStorageKey,
} from "../worldStorageKeys";
import type { WorldRoomAction } from "./reducer";
import type { WorldView } from "./types";
import { apiRequest, rememberRoom } from "./world-room-transport";

export interface WorldRoomBootstrapOptions {
  storageKey?: string;
  worldId?: string;
  initialRoomId?: string;
  group?: GroupCard;
  autoCreate: boolean;
  archiveLibraryId?: string;
  linkedArchiveStorageKey: string;
  dispatch: Dispatch<WorldRoomAction>;
  setRoomId: (roomId: string | undefined) => void;
  roomIdRef: MutableRefObject<string | undefined>;
  importantEventSequence: MutableRefObject<number>;
  lastStreamSequence: MutableRefObject<number>;
  lastSavedEventSequence: MutableRefObject<number>;
}

export async function bootstrapWorldRoom(
  options: WorldRoomBootstrapOptions,
  forceNew = false,
  startAfterCreate = false,
  skipArchiveRestore = false,
): Promise<boolean> {
  const {
    storageKey = options.worldId
      ? worldRoomStorageKey(options.worldId)
      : DEFAULT_WORLD_ROOM_STORAGE_KEY,
    worldId,
    initialRoomId,
    group,
    autoCreate,
    archiveLibraryId,
    linkedArchiveStorageKey,
    dispatch,
    setRoomId,
    roomIdRef,
    importantEventSequence,
    lastStreamSequence,
    lastSavedEventSequence,
  } = options;

  dispatch({ type: "loading" });
  try {
    if (forceNew) {
      const previousRoomId = roomIdRef.current;
      importantEventSequence.current = 0;
      localStorage.removeItem(storageKey);
      if (!archiveLibraryId && skipArchiveRestore) {
        localStorage.removeItem(linkedArchiveStorageKey);
      }
      if (previousRoomId) {
        await apiRequest(
          `/api/v1/worlds/${encodeURIComponent(previousRoomId)}/stop`,
          { method: "POST" },
        ).catch(() => undefined);
      }
    }
    const stored = forceNew
      ? undefined
      : initialRoomId || localStorage.getItem(storageKey) || undefined;
    if (stored) {
      const restored = await apiRequest(`/api/v1/worlds/${encodeURIComponent(stored)}`);
      if (
        restored.ok &&
        restored.view &&
        (!worldId || restored.view.world.id === worldId)
      ) {
        const localArchive = await getWorldArchive(
          restored.view.world.archiveId,
        ).catch(() => undefined);
        lastSavedEventSequence.current = localArchive?.archive.metadata.eventSequence ?? 0;
        importantEventSequence.current = restored.view.world.eventSequence;
        lastStreamSequence.current = restored.view.lastStreamSequence;
        roomIdRef.current = stored;
        rememberRoom(storageKey, stored);
        setRoomId(stored);
        dispatch({ type: "view_loaded", view: restored.view });
        return true;
      }
      if (restored.ok && restored.view && worldId && restored.view.world.id !== worldId) {
        if (stored === initialRoomId) {
          throw new Error("链接中的世界实例与当前世界不匹配。");
        }
        localStorage.removeItem(storageKey);
      } else if (restored.code !== "room_not_found") {
        throw new Error(restored.message || "无法恢复世界。");
      }
      localStorage.removeItem(storageKey);
      roomIdRef.current = undefined;
    }

    let linkedArchiveId = skipArchiveRestore
      ? undefined
      : archiveLibraryId ?? localStorage.getItem(linkedArchiveStorageKey) ?? undefined;
    if (!linkedArchiveId && !skipArchiveRestore && !group && worldId) {
      const latestMatchingArchive = (await listWorldArchives()).find(
        (record) => record.archive.worldId === worldId,
      );
      if (latestMatchingArchive) {
        linkedArchiveId = latestMatchingArchive.libraryId;
        localStorage.setItem(linkedArchiveStorageKey, linkedArchiveId);
      }
    }
    if (linkedArchiveId) {
      const record = await getWorldArchive(linkedArchiveId);
      if (!record) {
        localStorage.removeItem(linkedArchiveStorageKey);
        if (archiveLibraryId) throw new Error("找不到要继续的本地世界存档。");
      } else if (worldId && record.archive.worldId !== worldId) {
        if (archiveLibraryId) throw new Error("本地存档与当前世界不匹配。");
        localStorage.removeItem(linkedArchiveStorageKey);
      } else {
        const bundles = await loadBoundWorldSourceBundles(
          record.archive.definition.sources,
        );
        const restored = await apiRequest("/api/v1/worlds", {
          method: "POST",
          body: JSON.stringify({
            source: {
              kind: "world_archive",
              archive: record.archive,
              bundles,
            },
          }),
        });
        if (!restored.ok || !restored.roomId || !restored.view) {
          throw new Error(restored.message || "世界存档恢复失败。");
        }
        lastSavedEventSequence.current = record.archive.metadata.eventSequence;
        importantEventSequence.current = restored.view.world.eventSequence;
        localStorage.setItem(linkedArchiveStorageKey, record.libraryId);
        rememberRoom(storageKey, restored.roomId);
        lastStreamSequence.current = restored.view.lastStreamSequence;
        roomIdRef.current = restored.roomId;
        setRoomId(restored.roomId);
        dispatch({ type: "view_loaded", view: restored.view });
        return true;
      }
    }

    if (!forceNew && !autoCreate) {
      setRoomId(undefined);
      roomIdRef.current = undefined;
      dispatch({ type: "idle" });
      return false;
    }

    if (!group) {
      throw new Error("当前世界没有可恢复的本地存档。");
    }
    const created = await apiRequest("/api/v1/worlds", {
      method: "POST",
      body: JSON.stringify({ source: { kind: "group_card", group } }),
    });
    if (!created.ok || !created.roomId || !created.view) {
      throw new Error(created.message || "无法创建世界。");
    }
    lastSavedEventSequence.current = 0;
    importantEventSequence.current = 0;
    let nextView: WorldView = created.view;
    if (startAfterCreate) {
      const started = await apiRequest(
        `/api/v1/worlds/${encodeURIComponent(created.roomId)}/start`,
        { method: "POST" },
      );
      if (!started.ok || !started.view) {
        throw new Error(started.message || "世界创建成功，但未能开始运行。");
      }
      nextView = started.view;
    }
    if (created.archive) {
      const archiveRecord = await saveWorldArchive(created.archive, created.roomId);
      localStorage.setItem(linkedArchiveStorageKey, archiveRecord.libraryId);
      lastSavedEventSequence.current = created.archive.snapshot.eventSequence;
    }
    importantEventSequence.current = nextView.world.eventSequence;
    rememberRoom(storageKey, created.roomId);
    lastStreamSequence.current = nextView.lastStreamSequence;
    roomIdRef.current = created.roomId;
    setRoomId(created.roomId);
    dispatch({ type: "view_loaded", view: nextView });
    return true;
  } catch (error) {
    dispatch({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
