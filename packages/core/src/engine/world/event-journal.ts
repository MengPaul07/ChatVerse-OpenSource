import type {
  WorldEvent,
  WorldEventInput,
  WorldEventType,
  WorldEventListener,
  WorldUnsubscribe,
} from "../../contracts/world.js";
import type { RuntimeHost } from "../../runtime/types.js";

export class WorldEventJournal {
  private readonly events: WorldEvent[];
  private readonly listeners = new Set<WorldEventListener>();
  private sequence: number;

  constructor(
    private readonly worldId: string,
    private readonly runtime: RuntimeHost,
    initialEvents: readonly WorldEvent[] = [],
    initialSequence = 0,
  ) {
    this.events = initialEvents.map(cloneEvent);
    this.sequence = Math.max(
      initialSequence,
      ...this.events.map((event) => event.sequence),
      0,
    );
  }

  append<TType extends WorldEventType>(
    input: WorldEventInput<TType>,
  ): WorldEvent<TType> {
    const event = {
      id: this.runtime.idGenerator.next(),
      worldId: this.worldId,
      sequence: ++this.sequence,
      occurredAt: this.runtime.clock.now(),
      ...input,
    } as WorldEvent<TType>;
    this.events.push(event);
    for (const listener of [...this.listeners]) {
      try {
        listener(cloneEvent(event));
      } catch {
        // Domain observers cannot interrupt world state commits.
      }
    }
    return cloneEvent(event);
  }

  read(afterSequence = 0, limit = Number.POSITIVE_INFINITY): WorldEvent[] {
    return this.events
      .filter((event) => event.sequence > afterSequence)
      .slice(0, limit)
      .map(cloneEvent);
  }

  all(): WorldEvent[] {
    return this.events.map(cloneEvent);
  }

  get(eventId: string): WorldEvent | undefined {
    const event = this.events.find((candidate) => candidate.id === eventId);
    return event ? cloneEvent(event) : undefined;
  }

  get lastSequence(): number {
    return this.sequence;
  }

  subscribe(listener: WorldEventListener): WorldUnsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function cloneEvent<TType extends WorldEventType>(
  event: WorldEvent<TType>,
): WorldEvent<TType> {
  return {
    ...event,
    payload: cloneValue(event.payload),
  };
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
