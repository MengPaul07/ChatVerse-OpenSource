import type { WorldEvent } from "@chatverse/core";

/**
 * Holds committed presentation entries behind the server-owned turn frontier.
 * The World journal remains authoritative, while SSE only exposes a turn once
 * PresentationController promotes it to current.
 */
export class PresentationStreamGate {
  private readonly pending = new Map<string, WorldEvent>();

  capture(event: WorldEvent, presentationContext: boolean): boolean {
    if (!presentationContext || !isPresentationEntryEvent(event)) return false;
    this.pending.set(event.id, event);
    return true;
  }

  release(entryIds: readonly string[]): WorldEvent[] {
    const released: WorldEvent[] = [];
    for (const entryId of entryIds) {
      const event = this.pending.get(entryId);
      if (!event) continue;
      this.pending.delete(entryId);
      released.push(event);
    }
    return released;
  }

  clear(): void {
    this.pending.clear();
  }
}

function isPresentationEntryEvent(event: WorldEvent): boolean {
  return (event.type === "context.message.committed" && event.payload.message.source === "character") ||
    event.type === "context.action.committed" ||
    event.type === "narrative.narration.committed";
}
