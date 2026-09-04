import type { HumanMessageInput } from "./types.js";

/**
 * 真人消息输入队列。它只保证输入有序提交，不决定谁发言。
 */
export class HumanMessageQueue {
  private readonly messages: HumanMessageInput[] = [];

  get length(): number {
    return this.messages.length;
  }

  enqueue(message: HumanMessageInput): void {
    this.messages.push({ ...message });
  }

  peek(): readonly HumanMessageInput[] {
    return this.messages;
  }

  drain(): HumanMessageInput[] {
    return this.messages.splice(0);
  }
}
