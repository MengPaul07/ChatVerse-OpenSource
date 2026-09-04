import type {
  ActorMemoryNode,
  WorldDebugCategory,
  WorldDebugEvent,
  WorldDebugSnapshot,
  ProviderProtocol,
} from "@chatverse/core";
import type { CSSProperties } from "react";
import type { Edge, Node } from "@xyflow/react";

export interface SessionView {
  characters: Array<{
    name: string;
    state: { attention: string };
    runtime: { idleRemainingSec?: number; consecutiveSilentCount?: number };
    hasScheduled: boolean;
    isGenerating: boolean;
  }>;
  queues: {
    triggers: Array<{ type: string; target: string }>;
    generating: Array<{ speaker: string; status: string }>;
    scheduled: Array<{ speaker: string; remainingSec: number }>;
  };
}

export function sessionView(value: Record<string, unknown>): SessionView {
  return value as unknown as SessionView;
}

export function buildMemoryGraph(snapshot: WorldDebugSnapshot): { nodes: Node[]; edges: Edge[] } {
  const semanticNodes = snapshot.memory.flatMap((item) => item.snapshot.nodes);
  const semanticEdges = snapshot.memory.flatMap((item) => item.snapshot.edges);
  const ids = new Set(semanticNodes.map((node) => node.id));
  const externalIds = [...new Set(semanticEdges.map((edge) => edge.toId).filter((id) => !ids.has(id)))];
  const nodes: Node[] = [
    ...semanticNodes.map((node, index) => ({
      id: node.id,
      position: { x: (index % 4) * 220, y: Math.floor(index / 4) * 120 },
      data: { label: `${node.title}\n${node.kind}` },
      style: memoryNodeStyle(node.kind),
    })),
    ...externalIds.map((id, index) => ({
      id,
      position: { x: ((semanticNodes.length + index) % 4) * 220, y: Math.floor((semanticNodes.length + index) / 4) * 120 },
      data: { label: id },
      style: memoryNodeStyle("external"),
    })),
  ];
  const edges: Edge[] = semanticEdges.map((edge) => ({
    id: edge.id,
    source: edge.fromNodeId,
    target: edge.toId,
    label: edge.type,
    animated: edge.type === "continues",
    style: { stroke: "#87948d" },
    labelStyle: { fill: "#66716b", fontSize: 10 },
  }));
  return { nodes, edges };
}

function memoryNodeStyle(kind: string): CSSProperties {
  const color = kind === "belief" ? "#7c6ca8"
    : kind === "relation" ? "#b06a5a"
      : kind === "episode" ? "#3c7f73"
    : kind === "chapter" ? "#ad7a2d"
          : kind === "self" ? "#335f88"
            : "#758078";
  return {
    width: 180,
    border: `1px solid ${color}`,
    borderRadius: 6,
    background: "#fff",
    color: "#202622",
    boxShadow: "0 1px 4px rgba(23,26,24,.08)",
    fontSize: 11,
    whiteSpace: "pre-line",
  };
}

export function findMemoryNode(snapshot: WorldDebugSnapshot, nodeId?: string): ActorMemoryNode | undefined {
  const nodes = snapshot.memory.flatMap((item) => item.snapshot.nodes);
  return nodes.find((node) => node.id === nodeId) ?? nodes[0];
}

export function eventSummary(event: WorldDebugEvent): string {
  const payload = event.payload;
  if (event.type === "harness.decision") {
    return `${String(payload.characterName ?? event.actorId ?? "Actor")} → ${String(payload.decision ?? "")}`;
  }
  if (event.type === "queue.message_scheduled") {
    return `${String(payload.speaker ?? event.actorId ?? "")} scheduled ${Math.round(Number(payload.delayMs ?? 0))}ms`;
  }
  if (event.type === "queue.message_sent") return `${String(payload.speaker ?? event.actorId ?? "")} sent`;
  if (event.type === "actor_memory.scheduled") return `memory scheduled · ${String(payload.pendingEvents ?? 0)} observations`;
  if (event.type === "actor_memory.completed") return `memory committed · ${String(payload.operationCount ?? 0)} operations`;
  if (event.type === "director.scheduled") return `next run ${payload.delayMs ?? 0}ms · ${payload.reason ?? ""}`;
  if (event.type === "director.task_retry") return `task correction · missing ${Array.isArray(payload.missingToolNames) ? payload.missingToolNames.join(", ") : "none"}`;
  if (event.type === "director.completed") return `task ${payload.taskStatus ?? "none"} · tools ${Array.isArray(payload.toolNames) ? payload.toolNames.join(", ") : "none"}`;
  if (event.type === "director.response") return `model response · ${payload.elapsedMs ?? "?"}ms`;
  if (event.type === "provider.usage") {
    const usage = tokenUsageFromEvent(event);
    const request = payload.requestContext as { purpose?: unknown } | undefined;
    const purpose = String(request?.purpose ?? payload.providerRole ?? "model");
    return `${purpose} · ${formatTokenCount(usage?.inputTokens ?? 0)} in / ${formatTokenCount(usage?.outputTokens ?? 0)} out`;
  }
  if (event.type === "context.message.committed") {
    const worldPayload = payload.payload as { message?: { characterName?: string; message?: string } } | undefined;
    return `${worldPayload?.message?.characterName ?? "message"}: ${worldPayload?.message?.message ?? ""}`;
  }
  return event.type;
}

export function durationValue(event: WorldDebugEvent): number | undefined {
  const value = event.payload.elapsedMs;
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

export function runtimeMetrics(events: readonly WorldDebugEvent[]): {
  speak: number;
  silent: number;
  committed: number;
  dropped: number;
  averageLatencyMs: number;
} {
  const latencies = events
    .map(durationValue)
    .filter((value): value is number => value !== undefined);
  return {
    speak: events.filter((event) => (
      event.type === "harness.decision" && event.payload.decision === "speak"
    )).length,
    silent: events.filter((event) => (
      event.type === "harness.decision" && event.payload.decision === "silent"
    )).length,
    committed: events.filter((event) => (
      event.type === "context.message.committed"
    )).length,
    dropped: events.filter((event) => (
      event.type === "queue.message_dropped" ||
      event.type === "queue.message_cancelled"
    )).length,
    averageLatencyMs: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : 0,
  };
}

export interface TokenUsageView {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitInputTokens?: number;
  reasoningTokens?: number;
  protocol?: ProviderProtocol;
}

export function tokenUsageFromEvent(event: WorldDebugEvent): TokenUsageView | undefined {
  if (event.type !== "provider.usage") return undefined;
  const candidate = event.payload.usage;
  if (!candidate || typeof candidate !== "object") return undefined;
  const usage = candidate as Partial<TokenUsageView>;
  if (
    typeof usage.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number" ||
    typeof usage.totalTokens !== "number"
  ) return undefined;
  return usage as TokenUsageView;
}

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((timestamp - Date.now()) / 100) / 10);
  return `${seconds.toFixed(1)}s`;
}

export function categoryLabel(category: WorldDebugCategory): string {
  const labels: Record<WorldDebugCategory, string> = {
    world: "World",
    director: "Director",
    context: "Context",
    harness: "Harness",
    queue: "Queue",
    memory: "Memory",
    provider: "Provider",
    error: "Error",
  };
  return labels[category];
}

export function contextEventCount(events: WorldDebugEvent[], contextId: string): number {
  return events.filter((event) => event.contextId === contextId).length;
}
