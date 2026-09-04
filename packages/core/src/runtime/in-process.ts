import type {
  RuntimeClock,
  RuntimeNotificationBus,
  RuntimeHost,
  RuntimeIdGenerator,
  RuntimeNotification,
  RuntimeNotificationListener,
  RuntimeScheduler,
  RuntimeTask,
  RuntimeUnsubscribe,
} from "./types.js";

class SystemClock implements RuntimeClock {
  now(): number {
    return Date.now();
  }
}

class SystemScheduler implements RuntimeScheduler {
  schedule(delayMs: number, task: () => void): RuntimeTask {
    const timeout = setTimeout(task, Math.max(0, delayMs));
    return { cancel: () => clearTimeout(timeout) };
  }
}

class UuidGenerator implements RuntimeIdGenerator {
  private fallbackCounter = 0;

  next(): string {
    const crypto = globalThis.crypto;
    if (crypto?.randomUUID) return crypto.randomUUID();
    this.fallbackCounter += 1;
    return `runtime-${Date.now().toString(36)}-${this.fallbackCounter.toString(36)}`;
  }
}

/** Listener failures are isolated so observers cannot break a running chat. */
export class InMemoryRuntimeNotificationBus implements RuntimeNotificationBus {
  private listeners = new Set<RuntimeNotificationListener>();

  publish(notification: RuntimeNotification): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(notification);
      } catch {
        // Runtime observers are intentionally best-effort.
      }
    }
  }

  subscribe(listener: RuntimeNotificationListener): RuntimeUnsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Default platform-neutral host used when callers do not inject one. */
export class InProcessRuntimeHost implements RuntimeHost {
  readonly clock: RuntimeClock;
  readonly scheduler: RuntimeScheduler;
  readonly idGenerator: RuntimeIdGenerator;
  readonly notifications: RuntimeNotificationBus;

  constructor(options: Partial<RuntimeHost> = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.scheduler = options.scheduler ?? new SystemScheduler();
    this.idGenerator = options.idGenerator ?? new UuidGenerator();
    this.notifications = options.notifications ?? new InMemoryRuntimeNotificationBus();
  }
}

/**
 * Deterministic host for core tests and embedders that own time themselves.
 * Call advanceBy/advanceTo to release due scheduled work.
 */
export class ManualRuntimeHost implements RuntimeHost {
  readonly clock: RuntimeClock;
  readonly scheduler: RuntimeScheduler;
  readonly idGenerator: RuntimeIdGenerator;
  readonly notifications: RuntimeNotificationBus;
  private currentTime: number;
  private nextTaskId = 0;
  private nextId = 0;
  private tasks: Array<{ id: number; dueAt: number; task: () => void; cancelled: boolean }> = [];

  constructor(
    startAt = 0,
    notifications: RuntimeNotificationBus = new InMemoryRuntimeNotificationBus(),
  ) {
    this.currentTime = startAt;
    this.clock = { now: () => this.currentTime };
    this.scheduler = {
      schedule: (delayMs, task) => {
        const entry = {
          id: ++this.nextTaskId,
          dueAt: this.currentTime + Math.max(0, delayMs),
          task,
          cancelled: false,
        };
        this.tasks.push(entry);
        return { cancel: () => { entry.cancelled = true; } };
      },
    };
    this.idGenerator = { next: () => `manual-${++this.nextId}` };
    this.notifications = notifications;
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.currentTime + Math.max(0, ms));
  }

  advanceTo(timestamp: number): void {
    this.currentTime = Math.max(this.currentTime, timestamp);
    while (true) {
      const due = this.tasks
        .filter((task) => !task.cancelled && task.dueAt <= this.currentTime)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!due) return;
      due.cancelled = true;
      due.task();
    }
  }

  /**
   * Exposes the next host-owned wake-up for deterministic runners. This is
   * intentionally read-only; production hosts do not need to reveal timers.
   */
  nextDueAt(): number | undefined {
    return this.tasks
      .filter((task) => !task.cancelled)
      .reduce<number | undefined>(
        (next, task) => next === undefined ? task.dueAt : Math.min(next, task.dueAt),
        undefined,
      );
  }

  /** Number of scheduled tasks that have not been cancelled or released. */
  pendingTaskCount(): number {
    return this.tasks.reduce((count, task) => count + (task.cancelled ? 0 : 1), 0);
  }
}
