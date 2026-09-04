import type { WorldView } from "./types";

type ConversationMode = NonNullable<WorldView["contexts"][number]["conversationMode"]>;
type ConversationStatus = WorldView["contexts"][number]["status"];

export interface ConversationRuntimeState {
  active: boolean;
  paused: boolean;
  stopped: boolean;
  canStart: boolean;
  canSend: boolean;
}

export function conversationRuntimeState(
  mode: ConversationMode,
  status: ConversationStatus,
): ConversationRuntimeState {
  const active = status === "active";
  const paused = status === "paused";
  const stopped = status === "stopped";

  return {
    active,
    paused,
    stopped,
    canStart: mode === "group" && status === "dormant",
    canSend: !stopped && !paused && (mode === "private" || active),
  };
}
