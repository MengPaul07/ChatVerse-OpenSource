import { createHash } from "node:crypto";
import type {
  ChatProvider,
  LLMMessage,
  ProviderRequestContext,
  TokenUsage,
} from "@chatverse/core";
import type {
  WorldRunPromptOperation,
  WorldRunPromptProvider,
  WorldRunPromptSegment,
  WorldRunPromptTrace,
  WorldRunPromptUsage,
} from "./types.js";

interface PromptTraceState {
  nextId: number;
  previous: Map<string, WorldRunPromptSegment[]>;
}

type PromptTraceLifecycle = "started" | "completed" | "error";
type PromptTraceObserver = (
  trace: WorldRunPromptTrace,
  lifecycle: PromptTraceLifecycle,
) => void;

export function createPromptTraceState(): PromptTraceState {
  return { nextId: 1, previous: new Map() };
}

/**
 * Observes Provider calls without changing their contract or enabling the
 * expensive full-prompt debug mode. The returned provider is safe to reuse
 * across World cold restores, so the benchmark can compare cache prefixes over
 * the whole run.
 */
export function createPromptTracingProvider(
  provider: ChatProvider,
  providerKind: WorldRunPromptProvider,
  traces: WorldRunPromptTrace[],
  state: PromptTraceState,
  observer?: PromptTraceObserver,
): ChatProvider {
  return {
    complete: async (params) => {
      const trace = startTrace(
        state,
        providerKind,
        "complete",
        params.requestContext,
        promptSegmentsFromComplete(params.systemPrompt, params.userPrompt),
        traces,
      );
      notifyTraceObserver(observer, trace, "started");
      try {
        const result = await provider.complete({
          ...params,
          onUsage: chainUsageListener(params.onUsage, (usage) => {
            trace.usage = usageSnapshot(usage);
          }),
        });
        finishTrace(trace, "completed");
        notifyTraceObserver(observer, trace, "completed");
        return result;
      } catch (error) {
        finishTrace(trace, "error");
        notifyTraceObserver(observer, trace, "error");
        throw error;
      }
    },

    stream: async function* (params) {
      const trace = startTrace(
        state,
        providerKind,
        "stream",
        params.requestContext,
        promptSegmentsFromComplete("", "stream"),
        traces,
      );
      notifyTraceObserver(observer, trace, "started");
      try {
        for await (const chunk of provider.stream({
          ...params,
          onUsage: chainUsageListener(params.onUsage, (usage) => {
            trace.usage = usageSnapshot(usage);
          }),
        })) {
          yield chunk;
        }
        finishTrace(trace, "completed");
        notifyTraceObserver(observer, trace, "completed");
      } catch (error) {
        finishTrace(trace, "error");
        notifyTraceObserver(observer, trace, "error");
        throw error;
      }
    },

    chat: async (params) => {
      const trace = startTrace(
        state,
        providerKind,
        "chat",
        params.requestContext,
        promptSegmentsFromMessages(params.messages),
        traces,
      );
      notifyTraceObserver(observer, trace, "started");
      try {
        const result = await provider.chat({
          ...params,
          onUsage: chainUsageListener(params.onUsage, (usage) => {
            trace.usage = usageSnapshot(usage);
          }),
        });
        if (result.usage) trace.usage = usageSnapshot(result.usage);
        finishTrace(trace, "completed");
        notifyTraceObserver(observer, trace, "completed");
        return result;
      } catch (error) {
        finishTrace(trace, "error");
        notifyTraceObserver(observer, trace, "error");
        throw error;
      }
    },
  };
}

function notifyTraceObserver(
  observer: PromptTraceObserver | undefined,
  trace: WorldRunPromptTrace,
  lifecycle: PromptTraceLifecycle,
): void {
  try {
    observer?.(trace, lifecycle);
  } catch {
    // Benchmark progress observers cannot affect Provider execution.
  }
}

function startTrace(
  state: PromptTraceState,
  provider: WorldRunPromptProvider,
  operation: WorldRunPromptOperation,
  requestContext: ProviderRequestContext | undefined,
  segments: WorldRunPromptSegment[],
  traces: WorldRunPromptTrace[],
): WorldRunPromptTrace {
  const startedAt = Date.now();
  const comparisonKey = promptComparisonKey(provider, operation, requestContext);
  const previous = state.previous.get(comparisonKey);
  const stablePrefixChars = calculateStablePrefixChars(segments, previous);
  const firstChangedSegment = firstChangedSegmentName(segments, previous);
  const preparedSegments = segments.map((segment, index) => ({
    ...segment,
    sameAsPrevious: Boolean(previous?.[index] && sameSegment(previous[index]!, segment)),
  }));
  state.previous.set(comparisonKey, preparedSegments.map(({ sameAsPrevious: _same, ...segment }) => ({
    ...segment,
    sameAsPrevious: false,
  })));
  const trace: WorldRunPromptTrace = {
    id: `prompt-${state.nextId++}`,
    provider,
    operation,
    purpose: requestContext?.purpose,
    turnId: requestContext?.turnId,
    contextId: requestContext?.contextId,
    actorId: requestContext?.actorId,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    status: "completed",
    comparedToPrevious: Boolean(previous),
    totalChars: segments.reduce((sum, segment) => sum + segment.chars, 0),
    estimatedTokens: segments.reduce((sum, segment) => sum + segment.estimatedTokens, 0),
    stablePrefixChars,
    stablePrefixRate: stablePrefixRate(stablePrefixChars, segments),
    ...(firstChangedSegment ? { firstChangedSegment } : {}),
    segments: preparedSegments,
  };
  traces.push(trace);
  return trace;
}

function promptComparisonKey(
  provider: WorldRunPromptProvider,
  operation: WorldRunPromptOperation,
  requestContext: ProviderRequestContext | undefined,
): string {
  const purpose = requestContext?.purpose ?? operation;
  const actorScope = (
    requestContext?.actorId &&
    (purpose === "actor_decision" || purpose === "actor_response")
  )
    ? `:${requestContext.actorId}`
    : "";
  return `${provider}:${purpose}${actorScope}`;
}

function finishTrace(
  trace: WorldRunPromptTrace,
  status: "completed" | "error",
): void {
  trace.finishedAt = Date.now();
  trace.durationMs = Math.max(0, trace.finishedAt - trace.startedAt);
  trace.status = status;
}

function promptSegmentsFromComplete(
  systemPrompt: string,
  userPrompt: string,
): WorldRunPromptSegment[] {
  return [
    ...splitPromptBlock("system", systemPrompt),
    ...splitPromptBlock("user", userPrompt),
  ];
}

function promptSegmentsFromMessages(messages: readonly LLMMessage[]): WorldRunPromptSegment[] {
  return messages.flatMap((message, index) => {
    const block = splitPromptBlock("message", message.content ?? "");
    return block.map((segment) => ({
      ...segment,
      name: `message:${index}:${message.role}/${segment.name}`,
    }));
  });
}

function splitPromptBlock(
  scope: "system" | "user" | "message",
  value: string,
): WorldRunPromptSegment[] {
  const text = value ?? "";
  const lines = text.split(/\r?\n/);
  const chunks: Array<{ name: string; text: string }> = [];
  let currentName = `${scope}:preamble`;
  let currentLines: string[] = [];
  for (const line of lines) {
    const heading = promptHeading(line);
    if (heading) {
      if (currentLines.length > 0) {
        chunks.push({ name: currentName, text: currentLines.join("\n") });
      }
      currentName = heading;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    chunks.push({ name: currentName, text: currentLines.join("\n") });
  }
  if (chunks.length === 0) chunks.push({ name: `${scope}:empty`, text: "" });
  return chunks.map(({ name, text: chunk }) => makeSegment(scope, name, chunk));
}

function makeSegment(
  scope: "system" | "user" | "message",
  name: string,
  text: string,
): WorldRunPromptSegment {
  const chars = [...text].length;
  return {
    scope,
    name: name.slice(0, 120),
    chars,
    estimatedTokens: chars > 0 ? Math.ceil(chars / 2) : 0,
    hash: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
    sameAsPrevious: false,
  };
}

function promptHeading(line: string): string | undefined {
  const text = line.trim();
  if (/^\[[^\]\r\n]{1,100}\]$/.test(text)) return text;
  if (/^【[^】\r\n]{1,100}】$/.test(text)) return text;
  return undefined;
}

function calculateStablePrefixChars(
  current: readonly WorldRunPromptSegment[],
  previous: readonly WorldRunPromptSegment[] | undefined,
): number {
  if (!previous) return 0;
  let chars = 0;
  for (let index = 0; index < current.length; index++) {
    const prior = previous[index];
    const next = current[index];
    if (!prior || !next || !sameSegment(prior, next)) break;
    chars += next.chars;
  }
  return chars;
}

function firstChangedSegmentName(
  current: readonly WorldRunPromptSegment[],
  previous: readonly WorldRunPromptSegment[] | undefined,
): string | undefined {
  if (!previous) return current[0]?.name;
  for (let index = 0; index < current.length; index++) {
    const prior = previous[index];
    const next = current[index];
    if (!prior || !next || !sameSegment(prior, next)) return next?.name ?? "removed";
  }
  return current.length < previous.length ? "removed" : undefined;
}

function sameSegment(
  left: WorldRunPromptSegment,
  right: WorldRunPromptSegment,
): boolean {
  return left.scope === right.scope && left.name === right.name && left.hash === right.hash;
}

function stablePrefixRate(
  chars: number,
  segments: readonly WorldRunPromptSegment[],
): number {
  const total = segments.reduce((sum, segment) => sum + segment.chars, 0);
  return total > 0 ? Math.round((chars / total) * 10_000) / 10_000 : 0;
}

function chainUsageListener(
  original: ((usage: TokenUsage) => void) | undefined,
  observer: (usage: TokenUsage) => void,
): ((usage: TokenUsage) => void) {
  return (usage) => {
    observer(usage);
    original?.(usage);
  };
}

function usageSnapshot(usage: TokenUsage): WorldRunPromptUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheHitInputTokens: usage.cacheHitInputTokens ?? 0,
    cacheMissInputTokens: usage.cacheMissInputTokens ?? 0,
  };
}
