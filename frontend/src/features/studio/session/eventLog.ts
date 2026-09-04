import type { WorldAuthoringSessionEvent } from "@chatverse/world-authoring";

export function mergeAuthoringEvents(current: WorldAuthoringSessionEvent[], incoming: WorldAuthoringSessionEvent[]): WorldAuthoringSessionEvent[] {
  const merged = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) merged.set(event.sequence, event);
  return [...merged.values()].sort((left, right) => left.sequence - right.sequence).slice(-1000);
}

export function authoringEventTitle(event: WorldAuthoringSessionEvent): string {
  switch (event.type) {
    case "turn.started": return `Turn ${event.turnId.split(":")[1] ?? ""} 开始`;
    case "step.started": return `Step ${event.step ?? "-"} 开始`;
    case "model.requested": return "请求创作模型";
    case "model.completed": return "模型完成判断";
    case "tool.called": return `调用 ${authoringToolCopy(event.data.name)}`;
    case "tool.completed": return `${authoringToolCopy(event.data.name)}完成`;
    case "step.completed": return `Step ${event.step ?? "-"} 结束`;
    case "draft.committed": return "草稿已提交";
    case "turn.completed": return "Turn 完成";
    case "turn.cancelled": return "Turn 已取消";
    case "turn.failed": return "Turn 失败";
    default: return event.type;
  }
}

export function authoringEventDetail(event: WorldAuthoringSessionEvent): string {
  const data = event.data;
  switch (event.type) {
    case "turn.started": return String(data.instruction ?? `草稿 revision ${data.draftRevision ?? "-"}`);
    case "step.started": return `${data.messageCount ?? 0} 条上下文 · revision ${data.draftRevision ?? "-"}`;
    case "model.requested": return "读取当前草稿、计划和上一轮工具结果";
    case "model.completed": {
      const usage = data.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : undefined;
      const names = Array.isArray(data.toolNames) ? data.toolNames.filter((name: unknown) => typeof name === "string") : [];
      return `${formatCompactNumber(Number(usage?.totalTokens ?? 0))} tokens${names.length ? ` · 下一步：${names.map(authoringToolCopy).join("、")}` : " · 自然语言回应"}`;
    }
    case "tool.called": return `${Number(data.argumentBytes ?? 0)} bytes 参数`;
    case "tool.completed": {
      const observation = data.observation && typeof data.observation === "object" ? data.observation as Record<string, unknown> : {};
      const detail = Object.entries(observation).map(([key, value]) => `${key}=${String(value)}`).join(" · ");
      return `${data.ok === false ? "失败" : "Observation"}${detail ? ` · ${detail}` : ""}`;
    }
    case "step.completed": return `退出：${harnessStopReasonCopy(String(data.reason ?? ""))}`;
    case "draft.committed": return `${data.operationCount ?? 0} 项修改 · revision ${data.revision ?? "-"}`;
    case "turn.completed": return `${data.steps ?? 0} steps · ${data.toolCalls ?? 0} tools · ${harnessStopReasonCopy(String(data.stopReason ?? ""))}`;
    case "turn.cancelled": return harnessStopReasonCopy(String(data.reason ?? "cancelled"));
    case "turn.failed": return String(data.error ?? "未知错误");
    default: return "";
  }
}

export function authoringEventTone(event: WorldAuthoringSessionEvent): "neutral" | "active" | "success" | "danger" {
  if (event.type === "turn.failed" || (event.type === "tool.completed" && event.data.ok === false)) return "danger";
  if (event.type === "draft.committed" || event.type === "turn.completed") return "success";
  if (event.type === "model.requested" || event.type === "tool.called" || event.type === "step.started") return "active";
  return "neutral";
}

export function authoringToolCopy(value: unknown): string {
  switch (value) {
    case "inspect_draft": return "检查草稿";
    case "inspect_source_materials": return "检索世界资料";
    case "write_source_documents": return "整理 Markdown 资料";
    case "write_authoring_plan": return "创作计划";
    case "update_world_core": return "更新世界核心";
    case "save_player_card": return "保存玩家角色卡";
    case "save_actor": return "保存角色卡";
    case "save_relations": return "保存角色关系";
    case "save_context": return "保存开场场景";
    case "save_chapter": return "保存剧情章节";
    case "remove_draft_entities": return "删除草稿内容";
    case "set_runtime_profile": return "更新运行模式";
    case "validate_draft": return "校验草稿";
    case "research_web": return "联网检索";
    case "finish": return "完成本轮";
    default: return typeof value === "string" ? value : "工具";
  }
}

export function harnessStopReasonCopy(value: unknown): string {
  switch (value) {
    case "finished": return "任务已完成";
    case "natural_response": return "自然回应";
    case "no_change": return "没有需要修改";
    case "round_limit": return "达到 Step 预算";
    case "tools_observed": return "工具结果已回灌";
    case "task_paused":
    case "cancelled": return "已暂停";
    case "failed": return "执行失败";
    default: return value ? String(value) : "尚未运行";
  }
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}
