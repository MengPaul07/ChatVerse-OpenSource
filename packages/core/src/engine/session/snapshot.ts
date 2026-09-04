import type { SessionSnapshot } from "../../contracts/chat.js";
import { cloneConversationDigest } from "../../context/history-compression.js";
import type { ScheduledMessage } from "../queues/types.js";
import type { SessionState } from "../state.js";

export function buildSessionSnapshot(input: {
  id: string;
  state: SessionState;
  scheduled: readonly ScheduledMessage[];
  now: number;
}): SessionSnapshot {
  const { state } = input;
  return {
    id: input.id,
    messages: state.messages.map((message) => ({ ...message })),
    actions: state.actions.map((action) => ({ ...action })),
    scene: {
      groupName: state.scene.groupName,
      topic: state.scene.topic,
      atmosphere: state.scene.atmosphere,
      state: state.scene.state,
      rules: state.scene.rules ? [...state.scene.rules] : undefined,
    },
    characterStates: [...state.characterStates.values()].map((characterState) => ({ ...characterState })),
    scheduledMessages: input.scheduled.map((scheduled) => ({ ...scheduled })),
    conversationDigest: cloneConversationDigest(state.conversationDigest),
    timestamp: input.now,
  };
}
