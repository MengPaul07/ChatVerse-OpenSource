import type { ActorAction, ChatMessage } from "../../contracts/chat.js";
import { DebugEmitter } from "../../observability/debug/index.js";
import type { RuntimeNotification } from "../../runtime/index.js";

export interface SessionMessageCommitHost {
  readonly debug: DebugEmitter;
  readonly messages: ChatMessage[];
  readonly actions: ActorAction[];
  nextId(): string;
  now(): number;
  notify(type: RuntimeNotification["type"], payload: Record<string, unknown>): void;
  onMessageCommitted(): void;
}

export function commitSessionMessage(
  host: SessionMessageCommitHost,
  input: { characterName: string; text: string; source: ChatMessage["source"] },
): ChatMessage {
  const message: ChatMessage = {
    id: host.nextId(),
    characterName: input.characterName,
    message: input.text,
    timestamp: host.now(),
    source: input.source,
  };
  host.messages.push(message);
  host.debug.emit({ type: "message.injected", message });
  host.notify("message.committed", {
    messageId: message.id,
    characterName: message.characterName,
    source: message.source,
  });
  host.onMessageCommitted();
  return message;
}

export function commitSessionAction(
  host: SessionMessageCommitHost,
  participantName: string,
  text: string,
): ActorAction {
  const action: ActorAction = {
    id: host.nextId(),
    characterName: participantName,
    action: text,
    timestamp: host.now(),
  };
  host.actions.push(action);
  host.debug.emit({ type: "queue.message_sent", messageId: action.id, speaker: participantName, outputKind: "action" });
  host.notify("action.committed", { actionId: action.id, characterName: participantName });
  return action;
}
