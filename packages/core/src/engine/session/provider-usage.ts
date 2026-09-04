import type { ProviderUsageEvent, ProviderUsageEventListener } from "../../contracts/provider.js";

export class SessionProviderUsageRuntime {
  private readonly listeners = new Set<ProviderUsageEventListener>();

  subscribe(listener: ProviderUsageEventListener): () => boolean {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ProviderUsageEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(structuredClone(event));
      } catch {
        // Usage observers cannot interrupt a successful model request.
      }
    }
  }
}
