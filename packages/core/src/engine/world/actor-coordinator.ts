interface PendingLease {
  priority: number;
  sequence: number;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ActorGenerationCoordinator {
  private readonly active = new Set<string>();
  private readonly pending = new Map<string, PendingLease[]>();
  private requestSequence = 0;

  /**
   * A world-level view used by Director inspection. It is deliberately only a
   * scheduling status; prompt code must not infer mood or availability from it.
   */
  getStatus(actorId: string): "ready" | "generating" | "queued" {
    if (this.active.has(actorId)) return "generating";
    if ((this.pending.get(actorId)?.length ?? 0) > 0) return "queued";
    return "ready";
  }

  acquire(actorId: string, priority: number, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (!this.active.has(actorId)) {
      this.active.add(actorId);
      return Promise.resolve(this.createRelease(actorId));
    }

    return new Promise((resolve, reject) => {
      const queue = this.pending.get(actorId) ?? [];
      const lease: PendingLease = {
        priority,
        sequence: ++this.requestSequence,
        resolve,
        reject,
        signal,
      };
      if (signal) {
        lease.onAbort = () => {
          const pending = this.pending.get(actorId);
          const index = pending?.indexOf(lease) ?? -1;
          if (index >= 0) pending!.splice(index, 1);
          if (pending?.length === 0) this.pending.delete(actorId);
          reject(abortReason(signal));
        };
        signal.addEventListener("abort", lease.onAbort, { once: true });
      }
      queue.push(lease);
      queue.sort((left, right) => (
        right.priority - left.priority || left.sequence - right.sequence
      ));
      this.pending.set(actorId, queue);
    });
  }

  private createRelease(actorId: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const queue = this.pending.get(actorId);
      const next = queue?.shift();
      if (queue && queue.length === 0) this.pending.delete(actorId);
      if (next) {
        if (next.signal && next.onAbort) {
          next.signal.removeEventListener("abort", next.onAbort);
        }
        if (next.signal?.aborted) {
          next.reject(abortReason(next.signal));
          this.createRelease(actorId)();
          return;
        }
        next.resolve(this.createRelease(actorId));
      } else {
        this.active.delete(actorId);
      }
    };
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Actor generation lease was cancelled.", "AbortError");
}
