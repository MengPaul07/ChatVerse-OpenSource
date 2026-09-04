import type {
  WorldAuthoringHarnessState,
  WorldAuthoringSessionEvent,
  WorldAuthoringSessionEventType,
} from "@chatverse/world-authoring";
import type { AuthoringStreamKind } from "./stream.js";

export interface AuthoringHarnessCounters {
  currentTurnId?: string;
  turnCount: number;
  stepCount: number;
  modelRequestCount: number;
  toolCallCount: number;
  totalTokens: number;
  lastStopReason?: WorldAuthoringHarnessState["lastStopReason"];
}

export class AuthoringSessionLog {
  private readonly events: WorldAuthoringSessionEvent[] = [];
  private sequence = 0;

  constructor(
    private readonly now: () => number,
    private readonly publish: (kind: AuthoringStreamKind, data?: Record<string, unknown>) => void,
  ) {}

  get lastSequence(): number {
    return this.sequence;
  }

  list(afterSequence = 0, limit = 500): WorldAuthoringSessionEvent[] {
    const safeLimit = Math.max(1, Math.min(2000, Math.trunc(limit)));
    return structuredClone(
      this.events.filter((event) => event.sequence > afterSequence).slice(0, safeLimit),
    );
  }

  view(counters: AuthoringHarnessCounters): WorldAuthoringHarnessState {
    return {
      ...counters,
      lastEventSequence: this.sequence,
      recentEvents: structuredClone(this.events.slice(-120)),
    };
  }

  append(
    type: WorldAuthoringSessionEventType,
    data: Record<string, unknown>,
    turnId: string,
    step?: number,
  ): void {
    const event: WorldAuthoringSessionEvent = {
      sequence: ++this.sequence,
      occurredAt: this.now(),
      turnId,
      step,
      type,
      data,
    };
    this.events.push(event);
    this.publish("authoring.session_event", { event });
  }
}
