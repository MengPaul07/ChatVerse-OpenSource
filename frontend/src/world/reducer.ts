import type { WorldEvent, WorldNotification } from "@chatverse/core";
import type { WorldView } from "./types";
import {
  applyWorldEvent,
  applyWorldNotification,
  normalizeView,
} from "./reducer-projection";

export type WorldConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface WorldRoomState {
  phase: "idle" | "loading" | "ready" | "error";
  connection: WorldConnectionState;
  view?: WorldView;
  error?: string;
}

export type WorldRoomAction =
  | { type: "idle" }
  | { type: "view_loaded"; view: WorldView }
  | { type: "connection_changed"; connection: WorldConnectionState }
  | { type: "world_event"; sequence: number; event: WorldEvent }
  | { type: "world_notification"; sequence: number; notification: WorldNotification }
  | {
      type: "context_runtime";
      sequence: number;
      contextId: string;
      unreadCount: number;
      status: "dormant" | "active" | "paused" | "stopped";
      pauseReason?: "manual" | "unread" | "unobserved";
    }
  | { type: "action_error"; message: string }
  | { type: "error"; message: string }
  | { type: "loading" };

export const initialWorldRoomState: WorldRoomState = {
  phase: "loading",
  connection: "connecting",
};

export function worldRoomReducer(
  state: WorldRoomState,
  action: WorldRoomAction,
): WorldRoomState {
  switch (action.type) {
    case "idle":
      return { phase: "idle", connection: "closed" };
    case "loading":
      return { phase: "loading", connection: "connecting" };
    case "view_loaded":
      return {
        phase: "ready",
        connection: state.connection,
        view: normalizeView(action.view),
      };
    case "connection_changed":
      return { ...state, connection: action.connection };
    case "error":
      return { ...state, phase: "error", error: action.message };
    case "action_error":
      return state.view
        ? { ...state, phase: "ready", error: action.message }
        : { ...state, phase: "error", error: action.message };
    case "world_event":
      if (!state.view || action.sequence <= state.view.lastStreamSequence) return state;
      return {
        ...state,
        view: applyWorldEvent(state.view, action.sequence, action.event),
      };
    case "world_notification":
      if (!state.view || action.sequence <= state.view.lastStreamSequence) return state;
      return {
        ...state,
        view: applyWorldNotification(state.view, action.sequence, action.notification),
      };
    case "context_runtime":
      if (!state.view || action.sequence <= state.view.lastStreamSequence) return state;
      return {
        ...state,
        view: {
          ...state.view,
          lastStreamSequence: action.sequence,
          contexts: state.view.contexts.map((context) => context.id === action.contextId
            ? {
                ...context,
                status: action.status,
                pauseReason: action.pauseReason,
                unreadCount: action.unreadCount,
              }
            : context),
        },
      };
  }
}
