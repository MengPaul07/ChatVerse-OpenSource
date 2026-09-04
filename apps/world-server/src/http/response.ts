import type { ServerResponse } from "node:http";
import {
  AuthoringCapacityError,
  AuthoringConflictError,
  AuthoringValidationError,
} from "../authoring/session.js";
import { HttpError } from "./errors.js";
import { RoomCapacityError } from "../rooms/registry.js";

export function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function handleError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof RoomCapacityError) {
    sendJson(response, 503, {
      ok: false,
      code: "room_capacity_reached",
      message: "当前体验人数已满，请稍后再试。",
    });
    return;
  }
  if (error instanceof AuthoringCapacityError) {
    sendJson(response, 503, {
      ok: false,
      code: "authoring_capacity_reached",
      message: "当前创作会话已满，请稍后再试。",
    });
    return;
  }
  if (error instanceof AuthoringConflictError) {
    sendJson(response, 409, {
      ok: false,
      code: "authoring_conflict",
      message: error.message,
    });
    return;
  }
  if (error instanceof AuthoringValidationError) {
    sendJson(response, 400, {
      ok: false,
      code: "world_draft_validation_failed",
      message: "WorldDraft 尚未达到可预演状态。",
      validation: error.validation,
    });
    return;
  }
  if (error instanceof HttpError) {
    sendJson(response, error.status, {
      ok: false,
      code: error.code,
      message: error.message,
    });
    return;
  }
  console.error(error);
  sendJson(response, 500, {
    ok: false,
    code: "internal_error",
    message: "世界运行时发生错误。",
  });
}
