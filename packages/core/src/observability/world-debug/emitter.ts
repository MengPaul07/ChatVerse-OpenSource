import type { RuntimeHost } from "../../runtime/types.js";
import type {
  WorldDebugConfig,
  WorldDebugEvent,
  WorldDebugEventInput,
  WorldDebugListener,
  WorldTokenUsageBreakdown,
  WorldTokenUsageSnapshot,
  WorldTokenUsageTotals,
} from "../../contracts/world-debug.js";

const DEFAULT_MAX_EVENTS = 2_000;

/** Bounded, observation-only diagnostics. Listener failures never affect World. */
export class WorldDebugEmitter {
  private readonly listeners = new Set<WorldDebugListener>();
  private readonly values: WorldDebugEvent[] = [];
  private readonly tokenTotals = emptyTokenTotals();
  private readonly tokenByRole = new Map<string, WorldTokenUsageTotals>();
  private readonly tokenByPurpose = new Map<string, WorldTokenUsageTotals>();
  private readonly tokenByActor = new Map<string, WorldTokenUsageTotals>();
  private readonly tokenByModel = new Map<string, WorldTokenUsageTotals>();
  private readonly tokenByTurn = new Map<string, WorldTokenUsageTotals>();
  private firstTokenUsageAt?: number;
  private lastTokenUsageAt?: number;
  private sequence = 0;
  readonly config: Required<WorldDebugConfig>;

  constructor(
    config: boolean | WorldDebugConfig | undefined,
    private readonly worldId: string,
    private readonly runtime: RuntimeHost,
  ) {
    const resolved = config === true ? { enabled: true } : config || {};
    this.config = {
      enabled: resolved.enabled ?? false,
      tracePrompts: resolved.tracePrompts ?? false,
      traceResponses: resolved.traceResponses ?? false,
      traceToolCalls: resolved.traceToolCalls ?? true,
      includeMemoryContent: resolved.includeMemoryContent ?? true,
      maxEvents: clampInteger(resolved.maxEvents, DEFAULT_MAX_EVENTS, 100, 10_000),
    };
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get events(): readonly WorldDebugEvent[] {
    return this.values;
  }

  get lastSequence(): number {
    return this.sequence;
  }

  get droppedEventCount(): number {
    return Math.max(0, this.sequence - this.values.length);
  }

  get tokenUsage(): WorldTokenUsageSnapshot {
    return {
      ...this.tokenTotals,
      firstObservedAt: this.firstTokenUsageAt,
      lastObservedAt: this.lastTokenUsageAt,
      byRole: breakdown(this.tokenByRole),
      byPurpose: breakdown(this.tokenByPurpose),
      byActor: breakdown(this.tokenByActor),
      byModel: breakdown(this.tokenByModel),
      byTurn: breakdown(this.tokenByTurn),
    };
  }

  on(listener: WorldDebugListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(input: WorldDebugEventInput): void {
    if (!this.enabled) return;
    const event: WorldDebugEvent = {
      ...input,
      id: this.runtime.idGenerator.next(),
      sequence: ++this.sequence,
      occurredAt: this.runtime.clock.now(),
      worldId: this.worldId,
      payload: cloneValue(input.payload),
    };
    this.recordTokenUsage(event);
    this.values.push(event);
    const overflow = this.values.length - this.config.maxEvents;
    if (overflow > 0) this.values.splice(0, overflow);
    for (const listener of [...this.listeners]) {
      try {
        listener(cloneValue(event));
      } catch {
        // Debug observers are best-effort and cannot interrupt simulation.
      }
    }
  }

  private recordTokenUsage(event: WorldDebugEvent): void {
    if (event.type !== "provider.usage") return;
    const usage = objectValue(event.payload.usage);
    if (!usage) return;
    const inputTokens = tokenValue(usage.inputTokens);
    const outputTokens = tokenValue(usage.outputTokens);
    const totalTokens = tokenValue(usage.totalTokens);
    if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
      return;
    }
    const delta: WorldTokenUsageTotals = {
      requestCount: 1,
      inputTokens,
      outputTokens,
      totalTokens,
      cacheHitInputTokens: tokenValue(usage.cacheHitInputTokens) ?? 0,
      cacheMissInputTokens: tokenValue(usage.cacheMissInputTokens) ?? 0,
      reasoningTokens: tokenValue(usage.reasoningTokens) ?? 0,
    };
    addTokenUsage(this.tokenTotals, delta);
    const requestContext = objectValue(event.payload.requestContext);
    addBreakdown(this.tokenByRole, stringValue(event.payload.providerRole), delta);
    addBreakdown(this.tokenByPurpose, stringValue(requestContext?.purpose), delta);
    addBreakdown(
      this.tokenByActor,
      stringValue(requestContext?.actorId) ?? event.actorId,
      delta,
    );
    addBreakdown(this.tokenByModel, stringValue(usage.model), delta);
    addBreakdown(this.tokenByTurn, stringValue(requestContext?.turnId), delta);
    this.firstTokenUsageAt ??= event.occurredAt;
    this.lastTokenUsageAt = event.occurredAt;
  }
}

function emptyTokenTotals(): WorldTokenUsageTotals {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 0,
    reasoningTokens: 0,
  };
}

function addTokenUsage(
  target: WorldTokenUsageTotals,
  delta: WorldTokenUsageTotals,
): void {
  target.requestCount += delta.requestCount;
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.totalTokens += delta.totalTokens;
  target.cacheHitInputTokens += delta.cacheHitInputTokens;
  target.cacheMissInputTokens += delta.cacheMissInputTokens;
  target.reasoningTokens += delta.reasoningTokens;
}

function addBreakdown(
  values: Map<string, WorldTokenUsageTotals>,
  key: string | undefined,
  delta: WorldTokenUsageTotals,
): void {
  if (!key) return;
  const totals = values.get(key) ?? emptyTokenTotals();
  addTokenUsage(totals, delta);
  values.set(key, totals);
}

function breakdown(
  values: ReadonlyMap<string, WorldTokenUsageTotals>,
): WorldTokenUsageBreakdown[] {
  return [...values.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function tokenValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(Math.max(min, Math.min(max, parsed)));
}
