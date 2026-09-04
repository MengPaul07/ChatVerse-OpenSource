/** A clock supplied by the embedding runtime rather than the conversation core. */
export interface RuntimeClock {
  now(): number;
}

/** Handle returned by a scheduled host task. */
export interface RuntimeTask {
  cancel(): void;
}

/**
 * Timer primitive used by the session runner. It intentionally has no knowledge
 * of Director, Harness, or chat queues.
 */
export interface RuntimeScheduler {
  schedule(delayMs: number, task: () => void): RuntimeTask;
}

/** Allows deterministic IDs in tests and platform-specific UUID implementations. */
export interface RuntimeIdGenerator {
  next(): string;
}

export type RuntimeNotificationType =
  | "session.status_changed"
  | "message.committed"
  | "action.committed"
  | "queue.message_scheduled"
  | "queue.message_cancelled"
  | "agent.generating"
  | "agent.error"
  | "context.compression_started"
  | "context.compression_completed"
  | "context.compression_failed";

/**
 * Ordered, observation-only session notification. This protocol reports
 * committed runtime activity and never acts as a control channel.
 */
export interface RuntimeNotification {
  sessionId: string;
  sequence: number;
  occurredAt: number;
  type: RuntimeNotificationType;
  payload: Record<string, unknown>;
}

export type RuntimeNotificationListener = (notification: RuntimeNotification) => void;
export type RuntimeUnsubscribe = () => void;

/** Observation-only bus. Session inputs never travel through this interface. */
export interface RuntimeNotificationBus {
  publish(notification: RuntimeNotification): void;
  subscribe(listener: RuntimeNotificationListener): RuntimeUnsubscribe;
}

/**
 * All host-owned capabilities required by a running session. The default
 * implementation works in both browsers and Node.js.
 */
export interface RuntimeHost {
  clock: RuntimeClock;
  scheduler: RuntimeScheduler;
  idGenerator: RuntimeIdGenerator;
  notifications: RuntimeNotificationBus;
}
