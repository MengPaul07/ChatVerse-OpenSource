import type { TokenUsage } from "@chatverse/core";
import type {
  WorldAuthoringSessionEventType,
  WorldArchitectTrace,
  WorldResearchEvent,
} from "@chatverse/world-authoring";
import type { AuthoringStreamKind } from "./stream.js";
import {
  authoringToolLabel,
  numberValue,
  publicUsage,
  record,
  stringValue,
} from "./helpers.js";

export interface AuthoringTelemetryHost {
  appendSessionLog(
    type: WorldAuthoringSessionEventType,
    data: Record<string, unknown>,
    turnId: string,
    step?: number,
  ): void;
  publish(kind: AuthoringStreamKind, data?: Record<string, unknown>): void;
  incrementStep(): void;
  incrementModelRequest(): void;
  incrementToolCall(): void;
  addTokens(tokens: number): void;
}

export function recordAuthoringTrace(
  host: AuthoringTelemetryHost,
  turnId: string,
  event: WorldArchitectTrace,
): void {
  const step = event.round + 1;
  if (event.type === "prompt") {
    host.incrementStep();
    host.appendSessionLog("step.started", {
      messageCount: event.payload.messageCount,
      draftRevision: event.payload.revision,
    }, turnId, step);
    host.incrementModelRequest();
    host.appendSessionLog("model.requested", {
      purpose: "world_authoring",
    }, turnId, step);
    host.publish("authoring.agent_delta", {
      delta: `第 ${step} 轮 · 分析草稿与上一轮观察`,
      kind: "status",
    });
    return;
  }
  if (event.type === "response") {
    const usage = record(event.payload.usage);
    host.addTokens(numberValue(usage?.totalTokens) ?? 0);
    const calls = Array.isArray(event.payload.toolCalls) ? event.payload.toolCalls : [];
    const toolNames = calls
      .map((value) => stringValue(record(value)?.function && record(record(value)?.function)?.name))
      .filter(Boolean);
    host.appendSessionLog("model.completed", {
      toolNames,
      hasText: Boolean(stringValue(event.payload.content)?.trim()),
      usage: usage ? publicUsage(usage as unknown as TokenUsage) : undefined,
    }, turnId, step);
    return;
  }
  if (event.type === "tool_start") {
    host.incrementToolCall();
    host.appendSessionLog("tool.called", {
      callId: event.payload.callId,
      name: event.payload.name,
      argumentBytes: event.payload.argumentBytes,
    }, turnId, step);
    host.publish("authoring.agent_delta", {
      delta: `第 ${step} 轮 · ${authoringToolLabel(stringValue(event.payload.name))}`,
      kind: "status",
    });
    return;
  }
  if (event.type === "tool") {
    host.appendSessionLog("tool.completed", {
      callId: event.payload.callId,
      name: event.payload.name,
      ok: event.payload.ok,
      observation: event.payload.observation,
    }, turnId, step);
    return;
  }
  host.appendSessionLog("step.completed", {
    reason: event.payload.reason,
    draftRevision: event.payload.revision,
  }, turnId, step);
}

export function publishResearchStreamEvent(
  event: WorldResearchEvent,
): { kind: AuthoringStreamKind; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {
    type: event.type,
    query: event.query,
  };
  if (event.type === "started") data.purpose = event.purpose;
  if (event.type === "completed") {
    data.sourceCount = event.sourceCount;
    data.sources = event.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      note: source.note,
    }));
    if (event.usage) data.usage = publicUsage(event.usage);
  }
  if (event.type === "failed") data.error = event.error;
  return {
    kind: event.type === "started"
      ? "authoring.research_started"
      : event.type === "completed"
        ? "authoring.research_completed"
        : "authoring.research_failed",
    data,
  };
}
