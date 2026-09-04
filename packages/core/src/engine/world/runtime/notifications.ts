import type {
  WorldNotification,
  WorldNotificationListener,
  WorldNotificationPayloadMap,
  WorldNotificationType,
  WorldUnsubscribe,
} from "../../../contracts/world.js";
import type { WorldDebugEmitter } from "../../../observability/world-debug/index.js";

/** Distributes World notifications without allowing observers to affect execution. */
export class WorldNotificationRuntime {
  private readonly listeners = new Set<WorldNotificationListener>();
  private sequence = 0;

  constructor(
    private readonly worldId: string,
    private readonly now: () => number,
    private readonly debug: WorldDebugEmitter,
  ) {}

  on(listener: WorldNotificationListener): WorldUnsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void {
    const notification = {
      worldId: this.worldId,
      sequence: ++this.sequence,
      occurredAt: this.now(),
      type,
      payload,
    } as WorldNotification<TType>;
    for (const listener of [...this.listeners]) {
      try {
        listener(notification);
      } catch {
        // Observation listeners cannot break world execution.
      }
    }
    this.debug.emit({
      category: type.startsWith("director.")
        ? "director"
        : type.startsWith("actor_memory.")
          ? "memory"
          : type.includes("error")
            ? "error"
            : "world",
      type,
      level: type.includes("error") ? "error" : "info",
      contextId: "contextId" in payload && typeof payload.contextId === "string"
        ? payload.contextId
        : undefined,
      actorId: "actorId" in payload && typeof payload.actorId === "string"
        ? payload.actorId
        : undefined,
      payload,
    });
  }
}
