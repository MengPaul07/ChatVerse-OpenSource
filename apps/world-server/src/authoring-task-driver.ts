/**
 * Coalesces task wakeups into one serialized continuation. It deliberately does
 * not own persistence or cancellation of a provider call; the session owns both.
 */
export class AuthoringTaskDriver {
  private requested = false;
  private running?: Promise<void>;
  private closed = false;

  constructor(
    private readonly execute: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  request(): void {
    if (this.closed) return;
    this.requested = true;
    if (this.running) return;
    this.start();
  }

  cancelPending(): void {
    this.requested = false;
  }

  close(): void {
    this.closed = true;
    this.cancelPending();
  }

  get isRunning(): boolean {
    return this.running !== undefined;
  }

  private start(): void {
    const run = this.drain();
    this.running = run;
    void run.then(
      () => this.retire(run),
      (error) => {
        this.onError(error);
        this.retire(run);
      },
    );
  }

  private async drain(): Promise<void> {
    while (this.requested && !this.closed) {
      this.requested = false;
      await this.execute();
    }
  }

  private retire(run: Promise<void>): void {
    if (this.running !== run) return;
    this.running = undefined;
    if (this.requested && !this.closed) this.start();
  }
}
