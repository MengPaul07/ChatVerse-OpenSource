import type { GeneratingMessage } from "./types.js";
import type { RuntimeHost } from "../../runtime/types.js";

export class GeneratingMessageQueue {
  private items: GeneratingMessage[] = [];

  constructor(private readonly runtime: RuntimeHost) {}

  get length(): number { return this.items.length; }
  get all(): readonly GeneratingMessage[] { return [...this.items]; }

  start(input: {
    speaker: string;
    intent: string;
    now?: number;
    status?: GeneratingMessage["status"];
  }): GeneratingMessage {
    const now = input.now ?? this.runtime.clock.now();
    const item: GeneratingMessage = {
      id: this.runtime.idGenerator.next(),
      speaker: input.speaker,
      intent: input.intent,
      createdAt: now,
      status: input.status ?? "generating",
    };
    this.items.push(item);
    return item;
  }

  complete(id: string): GeneratingMessage | undefined {
    const idx = this.items.findIndex((m) => m.id === id);
    if (idx === -1) return undefined;
    return this.items.splice(idx, 1)[0];
  }

  hasSpeaker(speaker: string): boolean {
    return this.items.some((m) => m.speaker === speaker);
  }

  cancelAll(): GeneratingMessage[] {
    return this.items.splice(0);
  }

  setStatus(id: string, status: GeneratingMessage["status"]): void {
    const item = this.items.find((message) => message.id === id);
    if (item) item.status = status;
  }

  cancelSpeaker(speaker: string): GeneratingMessage[] {
    const cancelled: GeneratingMessage[] = [];
    this.items = this.items.filter((item) => {
      if (item.speaker !== speaker) return true;
      cancelled.push(item);
      return false;
    });
    return cancelled;
  }
}
