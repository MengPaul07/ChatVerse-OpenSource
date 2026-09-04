import type { WorldSnapshot } from "@chatverse/core";
import type { WorldRoom } from "./room.js";
import { HttpError } from "../http/errors.js";

export function requireRunningWorld(room: WorldRoom, contextId?: string): void {
  if (contextId && room.isConversationContext(contextId)) {
    const context = room.world.snapshot().contexts.find((candidate) => candidate.contextId === contextId);
    if (context?.status === "paused") {
      throw new HttpError(409, "context_paused", "这个通讯空间已暂停，请先在群聊窗口中继续。");
    }
    if (context?.status === "stopped") {
      throw new HttpError(409, "context_stopped", "这个通讯空间已经停止。");
    }
    return;
  }
  if (room.world.status === "running") return;
  throw new HttpError(
    409,
    "world_not_running",
    room.world.status === "idle"
      ? "请先开始世界，再发送消息或推进剧情。"
      : "世界当前未运行，请先继续或重新创建。",
  );
}

export function requireForegroundRecovery(
  room: WorldRoom,
  contextId: string,
  failureId: string,
): NonNullable<WorldSnapshot["foregroundRecovery"]>[number] {
  const snapshot = room.world.snapshot();
  if (!snapshot.contexts.some((context) => context.contextId === contextId)) {
    throw new HttpError(404, "context_not_found", "未找到对应的世界 Context。");
  }
  const recovery = snapshot.foregroundRecovery?.find((candidate) => candidate.contextId === contextId);
  if (!recovery) {
    throw new HttpError(404, "recovery_not_found", "当前 Context 没有待处理的恢复操作。");
  }
  if (recovery.status !== "failed" || recovery.failure?.id !== failureId) {
    throw new HttpError(409, "recovery_stale", "该恢复操作已经变化，请刷新世界状态后重试。");
  }
  return recovery;
}
