import { defineGroupCard } from "@chatverse/core";
import type { GroupCard } from "@chatverse/core";

/** Create the minimal editable group used by the manual creation flow. */
export function createBlankGroup(instanceId = `group_${Date.now()}`): GroupCard {
  return defineGroupCard({
    kind: "chatverse.group",
    schemaVersion: 1,
    metadata: {
      id: instanceId,
      name: "未命名群聊",
      description: "",
    },
    scene: {
      groupName: "未命名群聊",
      topic: "",
      atmosphere: "自然、可信，像真实群聊。",
      state: "flowing",
      rules: ["不要重复上一句已经表达的信息。", "没有新信息时可以保持沉默。"],
    },
    characters: [
      {
        name: "新角色",
        description: "",
        personality: "",
        scenario: "",
        messageExample: "",
        instructions: "保持人设一致。",
      },
    ],
    userProfiles: [{ name: "你", card: "群聊参与者" }],
    relations: { relations: [] },
    runtime: {
      pacing: { multiplier: 1 },
      messageStyle: {
        maxBurstCount: 3,
        allowStickers: true,
        preferShortMessages: true,
      },
      interaction: { interventionCommitWindowMs: 5000 },
      harness: { forceSpeakAfterConsecutiveSilents: true },
      contextCompression: {
        historyTokenThreshold: 12000,
        recentHistoryTokens: 3000,
        summaryMaxTokens: 1200,
        factsLimit: 8,
      },
    },
  });
}
