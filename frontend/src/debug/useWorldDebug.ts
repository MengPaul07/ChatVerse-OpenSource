import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorldDebugEvent,
  WorldDebugSnapshot,
} from "@chatverse/core";
import {
  DEFAULT_WORLD_ROOM_STORAGE_KEY,
  worldArchiveRoomStorageKey,
  worldRoomStorageKey,
} from "../worldStorageKeys";
import type { WorldView } from "../world/types";
import { providerRequestHeaders } from "../providerSettings";

export interface WorldDebugView {
  roomId: string;
  snapshot: WorldDebugSnapshot;
  actors: WorldView["actors"];
  transport: {
    debugClientCount: number;
    lastDebugSequence: number;
  };
}

export interface WorldDebugState {
  phase: "loading" | "ready" | "disabled" | "error";
  connection: "connecting" | "open" | "reconnecting" | "closed";
  view?: WorldDebugView;
  events: WorldDebugEvent[];
  error?: string;
}

export function useWorldDebug(options: {
  worldId?: string;
  archiveLibraryId?: string;
  initialRoomId?: string;
} = {}) {
  const [state, setState] = useState<WorldDebugState>({
    phase: "loading",
    connection: "connecting",
    events: [],
  });
  const streamRef = useRef<EventSource | null>(null);
  const snapshotRefreshTaskRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDebugSequenceRef = useRef(0);
  const [mutation, setMutation] = useState<{
    key?: string;
    error?: string;
  }>({});
  const storageKey = options.archiveLibraryId
    ? worldArchiveRoomStorageKey(options.archiveLibraryId)
    : options.worldId
      ? worldRoomStorageKey(options.worldId)
      : DEFAULT_WORLD_ROOM_STORAGE_KEY;
  const roomId = localStorage.getItem(storageKey) || options.initialRoomId;

  const loadSnapshot = useCallback(async (quiet = false) => {
    if (!roomId) {
      setState((current) => ({
        ...current,
        phase: "error",
        error: "还没有可调试的世界实例，请先打开一个世界。",
      }));
      return;
    }
    if (!quiet) {
      setState((current) => ({ ...current, phase: "loading" }));
    }
    try {
      const response = await fetch(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/debug?eventLimit=400`,
        { headers: providerRequestHeaders() },
      );
      const body = await response.json() as {
        ok?: boolean;
        debug?: WorldDebugView;
        code?: string;
        message?: string;
      };
      if (response.status === 404 && body.code === "debug_disabled") {
        setState((current) => ({
          ...current,
          phase: "disabled",
          error: body.message,
        }));
        return;
      }
      if (!response.ok || !body.debug) {
        throw new Error(body.message || "无法读取世界诊断快照。");
      }
      const debug = body.debug;
      lastDebugSequenceRef.current = debug.snapshot.lastDebugSequence;
      setState((current) => ({
        phase: "ready",
        connection: current.connection,
        view: debug,
        events: mergeEvents(current.events, debug.snapshot.events),
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: quiet && current.view ? current.phase : "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [roomId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!roomId || state.phase !== "ready" || streamRef.current) return;
    const after = lastDebugSequenceRef.current;
    const stream = new EventSource(
      `/api/v1/worlds/${encodeURIComponent(roomId)}/debug/stream?after=${after}`,
    );
    streamRef.current = stream;
    setState((current) => ({ ...current, connection: "connecting" }));
    stream.onopen = () => {
      setState((current) => ({ ...current, connection: "open" }));
    };
    stream.onerror = () => {
      setState((current) => ({ ...current, connection: "reconnecting" }));
    };
    stream.addEventListener("debug_event", ((message: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(message.data) as {
          kind: "debug_event";
          sequence: number;
          event: WorldDebugEvent;
        };
        if (!payload.event) return;
        lastDebugSequenceRef.current = Math.max(
          lastDebugSequenceRef.current,
          payload.sequence,
        );
        setState((current) => ({
          ...current,
          events: mergeEvents(current.events, [payload.event]),
          view: current.view ? {
            ...current.view,
            transport: {
              ...current.view.transport,
              lastDebugSequence: payload.sequence,
            },
          } : current.view,
        }));
        if (
          payload.event.type === "actor_memory.completed" ||
          payload.event.type === "actor.memory.updated" ||
          payload.event.type === "relation.updated"
        ) {
          if (snapshotRefreshTaskRef.current) clearTimeout(snapshotRefreshTaskRef.current);
          snapshotRefreshTaskRef.current = setTimeout(() => {
            snapshotRefreshTaskRef.current = null;
            void loadSnapshot(true);
          }, 250);
        }
      } catch {
        // A malformed diagnostic frame is ignored; the periodic snapshot heals it.
      }
    }) as EventListener);
    stream.addEventListener("debug_resync_required", (() => {
      void loadSnapshot(true);
    }) as EventListener);
    return () => {
      stream.close();
      streamRef.current = null;
      if (snapshotRefreshTaskRef.current) {
        clearTimeout(snapshotRefreshTaskRef.current);
        snapshotRefreshTaskRef.current = null;
      }
      setState((current) => ({ ...current, connection: "closed" }));
    };
  }, [loadSnapshot, roomId, state.phase]);

  const mutateActor = useCallback(async (
    actorId: string,
    action: "presence" | "participation" | "control",
    body: Record<string, unknown> = {},
  ) => {
    if (!roomId) return;
    const key = `${actorId}:${action}`;
    setMutation({ key });
    try {
      const response = await fetch(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/actors/${encodeURIComponent(actorId)}/${action}`,
        {
          method: "POST",
          headers: providerRequestHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        },
      );
      const result = await response.json() as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message || "Actor 状态修改失败。");
      }
      await loadSnapshot(true);
      setMutation({});
    } catch (error) {
      setMutation({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [loadSnapshot, roomId]);

  return {
    state,
    roomId,
    refresh: () => loadSnapshot(false),
    mutateActor,
    mutation,
  };
}

function mergeEvents(
  current: readonly WorldDebugEvent[],
  incoming: readonly WorldDebugEvent[],
): WorldDebugEvent[] {
  const values = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) values.set(event.id, event);
  return [...values.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-800);
}
