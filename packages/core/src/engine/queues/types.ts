export type { ScheduledMessage } from "../../contracts/queue.js";

/** 已获得发言机会、正在生成 Actor 决策的任务。 */
export interface GeneratingMessage {
  id: string;
  speaker: string;
  intent: string;
  createdAt: number;
  status: "waiting_for_actor" | "generating";
}

/** Harness 中每个 Actor 的局部调度状态。 */
export interface CharacterRuntimeState {
  characterName: string;
  /** 短防抖截止时间，避免同一 Actor 紧接着重复响应。 */
  mutedUntil?: number;
  /** 自主聊天模式下的下一次观察时间。 */
  idleCheckAt?: number;
  /** 这次自主观察属于哪一轮可见活动。旧轮次会在新消息提交后失效。 */
  idleRevision?: number;
  /** 这次观察是开场、回应还是静场机会。 */
  idleReason?: "opening" | "response" | "ambient" | "silent_retry";
  lastSpokeAt?: number;
  lastDecisionAt?: number;
  lastMentionedAt?: number;
  lastWakeAt?: number;
  lastWakeFrom?: string;
  wakeReason?: string;
  wakeStrength?: "weak" | "normal" | "strong";
  /** Consecutive autonomous opportunities that produced no visible output. */
  consecutiveSilentCount?: number;
  passiveBackoffCount?: number;
}
