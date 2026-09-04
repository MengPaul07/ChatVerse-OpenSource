import type { ScheduledMessage } from "./types.js";
import type { RuntimeHost } from "../../runtime/types.js";

export class ScheduledMessageQueue {
  private messages: ScheduledMessage[] = [];

  constructor(private readonly runtime: RuntimeHost) {}

  get length(): number { return this.messages.length; }
  get all(): readonly ScheduledMessage[] { return [...this.messages]; }

  get pending(): readonly ScheduledMessage[] {
    return [...this.messages].sort((a, b) => a.sendAt - b.sendAt);
  }

  schedule(input: {
    speaker: string;
    message: string;
    sendAt: number;
    reason?: string;
    now?: number;
    id?: string;
    statePatch?: ScheduledMessage["statePatch"];
    outputKind: ScheduledMessage["outputKind"];
    contextTransition?: ScheduledMessage["contextTransition"];
  }): ScheduledMessage {
    const now = input.now ?? this.runtime.clock.now();
    const msg: ScheduledMessage = {
      id: input.id ?? this.runtime.idGenerator.next(),
      speaker: input.speaker,
      message: input.message,
      outputKind: input.outputKind,
      contextTransition: input.contextTransition,
      sendAt: input.sendAt,
      createdAt: now,
      reason: input.reason,
      statePatch: input.statePatch,
    };
    this.messages.push(msg);
    return msg;
  }

  due(now?: number): ScheduledMessage[] {
    const n = now ?? this.runtime.clock.now();
    const due: ScheduledMessage[] = [];
    this.messages = this.messages.filter((m) => {
      if (m.sendAt <= n) { due.push(m); return false; }
      return true;
    });
    due.sort((a, b) => a.sendAt - b.sendAt);
    return due;
  }

  remove(id: string): ScheduledMessage | undefined {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return undefined;
    return this.messages.splice(idx, 1)[0];
  }

  cancel(id: string): ScheduledMessage | undefined {
    return this.remove(id);
  }

  cancelSpeaker(speaker: string): ScheduledMessage[] {
    const cancelled: ScheduledMessage[] = [];
    this.messages = this.messages.filter((message) => {
      if (message.speaker !== speaker) return true;
      cancelled.push(message);
      return false;
    });
    return cancelled;
  }

  accelerate(now = this.runtime.clock.now()): void {
    for (const message of this.messages) {
      message.sendAt = now;
    }
  }

  rescaleRemaining(ratio: number, now = this.runtime.clock.now()): void {
    if (!Number.isFinite(ratio) || ratio < 0) return;
    for (const message of this.messages) {
      const remaining = Math.max(0, message.sendAt - now);
      message.sendAt = now + remaining * ratio;
    }
  }
}
