import { useEffect, type Dispatch, type MutableRefObject } from "react";
import { saveTokenUsageRecord } from "../tokenUsageLibrary";
import type { WorldRoomAction } from "./reducer";
import {
  parseStreamPayload,
  resyncRoom,
  shouldAutoSaveEvent,
} from "./world-room-transport";

interface UseWorldRoomStreamOptions {
  roomId?: string;
  contextId?: string;
  dispatch: Dispatch<WorldRoomAction>;
  lastStreamSequence: MutableRefObject<number>;
  importantEventSequence: MutableRefObject<number>;
}

export function useWorldRoomStream({
  roomId,
  contextId,
  dispatch,
  lastStreamSequence,
  importantEventSequence,
}: UseWorldRoomStreamOptions): void {
  useEffect(() => {
    if (!roomId) return;
    const after = lastStreamSequence.current;
    const query = new URLSearchParams({ after: String(after) });
    if (contextId) query.set("context", contextId);
    const stream = new EventSource(
      `/api/v1/worlds/${encodeURIComponent(roomId)}/stream?${query.toString()}`,
    );
    dispatch({ type: "connection_changed", connection: "connecting" });

    stream.onopen = () => {
      dispatch({ type: "connection_changed", connection: "open" });
    };
    stream.onerror = () => {
      dispatch({ type: "connection_changed", connection: "reconnecting" });
    };

    const onPayload = (event: MessageEvent<string>) => {
      const payload = parseStreamPayload(event.data);
      if (!payload) return;
      lastStreamSequence.current = Math.max(lastStreamSequence.current, payload.sequence);
      if (payload.kind === "world_event") {
        if (shouldAutoSaveEvent(payload.event)) {
          importantEventSequence.current = Math.max(
            importantEventSequence.current,
            payload.event.sequence,
          );
        }
        dispatch({
          type: "world_event",
          sequence: payload.sequence,
          event: payload.event,
        });
      } else if (payload.kind === "world_notification") {
        dispatch({
          type: "world_notification",
          sequence: payload.sequence,
          notification: payload.notification,
        });
      } else if (payload.kind === "usage_recorded") {
        void saveTokenUsageRecord(payload.record).catch(() => undefined);
      } else if (payload.kind === "context_runtime") {
        dispatch({
          type: "context_runtime",
          sequence: payload.sequence,
          contextId: payload.contextId,
          unreadCount: payload.unreadCount,
          status: payload.status,
          pauseReason: payload.pauseReason,
        });
      } else {
        void resyncRoom(roomId, dispatch, (view) => {
          importantEventSequence.current = Math.max(
            importantEventSequence.current,
            view.world.eventSequence,
          );
        });
      }
    };

    stream.addEventListener("world_event", onPayload as EventListener);
    stream.addEventListener("world_notification", onPayload as EventListener);
    stream.addEventListener("usage_recorded", onPayload as EventListener);
    stream.addEventListener("context_runtime", onPayload as EventListener);
    stream.addEventListener("resync_required", onPayload as EventListener);
    return () => {
      stream.close();
      dispatch({ type: "connection_changed", connection: "closed" });
    };
  }, [contextId, dispatch, importantEventSequence, lastStreamSequence, roomId]);
}
