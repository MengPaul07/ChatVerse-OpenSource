import type { Dispatch } from "react";
import type { WorldEvent } from "@chatverse/core";
import type { ApiResponse, WorldStreamPayload, WorldView } from "./types";
import { providerRequestHeaders } from "../providerSettings";

export async function resyncRoom(
  roomId: string,
  dispatch: Dispatch<import("./reducer").WorldRoomAction>,
  onView?: (view: WorldView) => void,
): Promise<void> {
  const response = await apiRequest(`/api/v1/worlds/${encodeURIComponent(roomId)}`);
  if (response.ok && response.view) {
    onView?.(response.view);
    dispatch({ type: "view_loaded", view: response.view });
  } else {
    dispatch({ type: "error", message: response.message || "世界状态同步失败。" });
  }
}

export async function apiRequest(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse> {
  const response = await fetch(path, {
    ...init,
    headers: providerRequestHeaders({
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    }),
  });
  const body = await response.json().catch(() => ({
    ok: false,
    message: `服务返回了无法解析的响应（${response.status}）。`,
  })) as ApiResponse;
  return {
    ...body,
    ok: response.ok && body.ok !== false,
  };
}

export function parseStreamPayload(raw: string): WorldStreamPayload | undefined {
  try {
    const parsed = JSON.parse(raw) as WorldStreamPayload;
    return typeof parsed.sequence === "number" && typeof parsed.kind === "string"
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

const AUTO_SAVE_EVENT_TYPES = new Set<WorldEvent["type"]>([
  "context.message.committed",
  "context.action.committed",
  "context.activated",
  "context.suspended",
  "actor.registered",
  "actor.background.updated",
  "actor.presence.changed",
  "actor.participation.changed",
  "actor.control.changed",
  "actor.memory.recorded",
  "actor.memory.revised",
  "actor.memory.updated",
  "relation.added",
  "relation.updated",
  "relation.removed",
  "world.event.emitted",
  "world.progression.requested",
  "world.time.advanced",
  "player.directive",
  "narrative.narration.committed",
  "narrative.beat.recorded",
  "narrative.beat.completed",
  "narrative.beats.linked",
  "narrative.chapter.created",
  "narrative.chapter.completed",
  "narrative.chapter.activated",
  "narrative.chapter.focus_changed",
]);

export function shouldAutoSaveEvent(event: WorldEvent): boolean {
  return AUTO_SAVE_EVENT_TYPES.has(event.type);
}

export function rememberRoom(storageKey: string, roomId: string): void {
  localStorage.setItem(storageKey, roomId);
}

