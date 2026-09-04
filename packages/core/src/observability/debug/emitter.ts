import type { RuntimeHost } from "../../runtime/types.js";
import type {
  DebugConfig,
  DebugEvent,
  DebugEventInput,
  DebugEventListener,
  DebugUnsubscribe,
} from "./types.js";

const DEFAULT_MAX_EVENTS = 1000;

/**
 * DebugEmitter 是平台无关的追踪中心。
 * 它只保存事件并通知订阅者，不依赖 Node、DOM 或任何 UI。
 */
export class DebugEmitter {
  private readonly config: Required<DebugConfig>;
  private readonly sessionId: string;
  private readonly listeners = new Set<DebugEventListener>();
  private readonly _events: DebugEvent[] = [];

  constructor(config: DebugConfig | undefined, sessionId: string, private readonly runtime: RuntimeHost) {
    this.sessionId = sessionId;
    this.config = {
      enabled: config?.enabled ?? false,
      tracePrompts: config?.tracePrompts ?? false,
      traceResponses: config?.traceResponses ?? false,
      traceToolCalls: config?.traceToolCalls ?? true,
      traceTiming: config?.traceTiming ?? true,
      maxEvents: config?.maxEvents ?? DEFAULT_MAX_EVENTS,
    };
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get shouldTracePrompts(): boolean {
    return this.config.enabled && this.config.tracePrompts;
  }

  get shouldTraceResponses(): boolean {
    return this.config.enabled && this.config.traceResponses;
  }

  get shouldTraceToolCalls(): boolean {
    return this.config.enabled && this.config.traceToolCalls;
  }

  get shouldTraceTiming(): boolean {
    return this.config.enabled && this.config.traceTiming;
  }

  get events(): readonly DebugEvent[] {
    return this._events;
  }

  on(listener: DebugEventListener): DebugUnsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(input: DebugEventInput): void {
    if (!this.config.enabled) return;

    const event = {
      ...input,
      id: this.runtime.idGenerator.next(),
      sessionId: this.sessionId,
      timestamp: this.runtime.clock.now(),
    } as DebugEvent;

    this._events.push(event);
    this.trimEvents();

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private trimEvents(): void {
    const overflow = this._events.length - this.config.maxEvents;
    if (overflow > 0) {
      this._events.splice(0, overflow);
    }
  }
}
