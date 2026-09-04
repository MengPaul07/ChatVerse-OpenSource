import type { ActorAction, ChatMessage } from "../contracts/chat.js";
import { formatHistoryMessage } from "./conversation.js";

export interface ContextTimelineEntry {
  id?: string;
  timestamp: number;
  order: number;
  text: string;
}

export function projectChatTimeline(
  messages: readonly ChatMessage[],
  actions: readonly ActorAction[],
): ContextTimelineEntry[] {
  const earliestMessageAt = messages[0]?.timestamp ?? Number.NEGATIVE_INFINITY;
  return [
    ...messages.map((message, order) => ({
      id: message.id,
      timestamp: message.timestamp,
      order,
      text: formatHistoryMessage(message),
    })),
    ...actions
      .filter((action) => action.timestamp >= earliestMessageAt)
      .slice(-24)
      .map((action, index) => ({
        id: action.id,
        timestamp: action.timestamp,
        order: messages.length + index,
        text: `【${action.characterName}（动作）】：${action.action}`,
      })),
  ].sort(compareTimelineEntries);
}

/** Curator 折叠后的稳定时间线基准。只在下一次折叠时整体重写,其余回合保持不变。 */
export interface TimelineCheckpoint {
  /** 折叠出的较早事件摘要;为空表示尚未发生首次折叠。 */
  summary: string;
  /** Curator 保留的关键事实行。 */
  facts: string[];
  /** 已折叠到的最大事件序号(不含)。 */
  throughSequence: number;
  curatedAt: number;
}

export interface TimelineProjection {
  /** 完整时间线块文本:摘要 + 事实 + 自 checkpoint 以来的新增行。 */
  block: string;
  /** 自 checkpoint 以来的新增行数(curator 触发依据)。 */
  pendingRowCount: number;
  /** 新增行文本总字符数。 */
  pendingChars: number;
}

/**
 * 增量投影:历史行只增不改,提示词只携带 checkpoint 之后的新增行。
 * rows 必须按 order 升序,且已过滤到目标 Context(否则 checkpoint 语义失效)。
 * 同一 checkpoint 下,两次投影的 block 前缀保证一致(append-only)。
 */
export function projectIncrementalTimeline(
  checkpoint: TimelineCheckpoint | undefined,
  rows: readonly ContextTimelineEntry[],
  options: { maxRowChars?: number } = {},
): TimelineProjection {
  const fromSequence = checkpoint?.throughSequence ?? 0;
  const pending = rows.filter((row) => row.order > fromSequence);
  const maxRowChars = options.maxRowChars ?? 600;
  const sections: string[] = [];
  if (checkpoint?.summary) {
    sections.push(`【较早事件摘要】\n${checkpoint.summary}`);
  }
  if (checkpoint?.facts.length) {
    sections.push(`【关键事实】\n${checkpoint.facts.map((fact) => `- ${fact}`).join("\n")}`);
  }
  if (pending.length) {
    sections.push(`【新增事件】\n${pending.map((row) => truncateTimelineRow(row.text, maxRowChars)).join("\n")}`);
  }
  const block = sections.join("\n\n");
  const pendingChars = pending.reduce((sum, row) => sum + row.text.length, 0);
  return { block, pendingRowCount: pending.length, pendingChars };
}

function truncateTimelineRow(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export function formatContextTimeline(
  entries: readonly ContextTimelineEntry[],
  maxChars: number,
): string {
  const value = [...entries]
    .sort(compareTimelineEntries)
    .map((entry) => entry.text)
    .join("\n");
  if (value.length <= maxChars) return value;
  return `（更早的逐条记录已省略，以摘要为准。）\n${value.slice(-maxChars)}`;
}

function compareTimelineEntries(left: ContextTimelineEntry, right: ContextTimelineEntry): number {
  return left.timestamp - right.timestamp || left.order - right.order;
}
