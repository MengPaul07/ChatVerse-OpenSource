/** A single, character-scoped reason for evaluating a Harness agent. */
export interface HarnessTriggerInput {
  type: "mention" | "event" | "idle" | "wake";
  target: string;
  source?: "user" | "character" | "narrator" | "player_focus" | "player_direct";
  messageId?: string;
  message?: string;
  reason?: string;
  requiresReply?: boolean;
  turnId?: string;
  priority: number;
}

export interface HarnessTrigger extends HarnessTriggerInput {
  enqueuedAt: number;
}

export type TriggerEnqueueResult = "enqueued" | "duplicate" | "target_busy";

/**
 * Deterministic priority queue for Harness decisions.
 *
 * It does not know about LLMs, clocks, scheduled messages, or character state.
 * The Session supplies readiness information at its boundary, which keeps this
 * component straightforward to test and reuse in another runner.
 */
export class HarnessTriggerQueue {
  private items: HarnessTrigger[] = [];

  get length(): number {
    return this.items.length;
  }

  get all(): readonly HarnessTrigger[] {
    return this.items.map((trigger) => ({ ...trigger }));
  }

  enqueue(
    trigger: HarnessTrigger,
    isTargetBusy: (target: string) => boolean,
  ): TriggerEnqueueResult {
    // Deliberate player requests and Narrator arbitration remain queued until
    // their target becomes ready. They are event-driven work, not idle probes.
    const retainWhileBusy = trigger.type === "mention" || (
      trigger.type === "wake" &&
      (
        trigger.source === "player_direct" ||
        trigger.source === "player_focus" ||
        trigger.source === "narrator"
      )
    );
    if (!retainWhileBusy && isTargetBusy(trigger.target)) {
      return "target_busy";
    }
    if (this.isDuplicate(trigger)) {
      return "duplicate";
    }

    const insertionIndex = this.items.findIndex((item) => item.priority < trigger.priority);
    if (insertionIndex === -1) this.items.push(trigger);
    else this.items.splice(insertionIndex, 0, trigger);
    return "enqueued";
  }

  takeNext(isReady: (trigger: HarnessTrigger) => boolean): HarnessTrigger | undefined {
    const index = this.items.findIndex(isReady);
    if (index === -1) return undefined;
    return this.items.splice(index, 1)[0];
  }

  clear(): HarnessTrigger[] {
    return this.items.splice(0);
  }

  removeTarget(target: string): HarnessTrigger[] {
    const removed: HarnessTrigger[] = [];
    this.items = this.items.filter((item) => {
      if (item.target !== target) return true;
      removed.push(item);
      return false;
    });
    return removed;
  }

  private isDuplicate(trigger: HarnessTrigger): boolean {
    if (trigger.type === "idle") {
      return this.items.some((item) => item.type === "idle" && item.target === trigger.target);
    }
    if (trigger.type === "mention") {
      return this.items.some((item) => (
        item.type === "mention" &&
        item.target === trigger.target &&
        item.messageId === trigger.messageId
      ));
    }
    if (trigger.type === "wake") {
      return this.items.some((item) => (
        item.type === "wake" &&
        item.target === trigger.target &&
        item.source === trigger.source &&
        item.messageId === trigger.messageId
      ));
    }
    return false;
  }
}
