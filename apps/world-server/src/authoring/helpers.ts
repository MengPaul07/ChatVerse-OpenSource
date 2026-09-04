import type { TokenUsage } from "@chatverse/core";
import type {
  WorldArchitectResult,
  WorldDraft,
  WorldAuthoringScope,
  WorldAuthoringPlan,
} from "@chatverse/world-authoring";

export function nextTaskItem(plan: WorldAuthoringPlan): WorldAuthoringPlan["items"][number] | undefined {
  return plan.items.find((item) => item.status === "in_progress") ?? plan.items.find((item) => item.status === "pending");
}

export function nextTaskPhase(plan: WorldAuthoringPlan): WorldAuthoringScope | undefined {
  return nextTaskItem(plan)?.scope;
}

export function restoreAsNewRevision(source: WorldDraft, revision: number, summary: string): WorldDraft {
  return { ...structuredClone(source), revision, lastChangeSummary: summary };
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }

export function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

export function publicUsage(usage: TokenUsage): Record<string, unknown> {
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cacheHitInputTokens: usage.cacheHitInputTokens, cacheMissInputTokens: usage.cacheMissInputTokens, reasoningTokens: usage.reasoningTokens, provider: usage.provider, model: usage.model, protocol: usage.protocol };
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function authoringToolLabel(name: string | undefined): string {
  switch (name) {
    case "inspect_draft": return "检查当前草稿";
    case "inspect_source_materials": return "检索世界资料";
    case "read_source_material": return "读取资料片段";
    case "write_source_documents": return "整理 Markdown 资料";
    case "write_authoring_plan": return "更新创作计划";
    case "update_world_core": return "更新世界核心";
    case "save_player_card": return "保存玩家角色卡";
    case "save_actor": return "保存角色卡";
    case "save_relations": return "保存角色关系";
    case "save_context": return "保存开场场景";
    case "save_chapter": return "保存章节计划";
    case "remove_draft_entities": return "删除草稿内容";
    case "set_runtime_profile": return "更新运行模式";
    case "validate_draft": return "校验可运行性";
    case "research_web": return "检索公开资料";
    case "finish": return "整理本轮结果";
    default: return name ? `调用 ${name}` : "执行工具";
  }
}

export function formatArchitectMarkdown(result: WorldArchitectResult): string {
  return [result.summary, ...result.questions.map((question) => `\n${question}`)].join("\n");
}
