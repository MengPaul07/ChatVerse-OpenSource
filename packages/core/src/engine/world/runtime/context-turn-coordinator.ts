export interface NarratorWakeReservation {
  beatId: string;
  startedSequence: number;
}

export interface ActorTurnReservation {
  id: string;
  beatId?: string;
  startedSequence: number;
}

/** Owns transient Context turn reservations shared by wake settlement and presentation. */
export class ContextTurnCoordinator {
  private readonly narratorWakes = new Map<string, NarratorWakeReservation>();
  private readonly actorTurns = new Map<string, ActorTurnReservation>();
  private readonly ambientWakes = new Set<string>();
  private ambientOutput = false;

  get pendingNarratorWakeCount(): number {
    return this.narratorWakes.size;
  }

  get pendingAmbientWakeCount(): number {
    return this.ambientWakes.size;
  }

  get ambientWakeProducedOutput(): boolean {
    return this.ambientOutput;
  }

  hasNarratorWake(actorId: string): boolean {
    return this.narratorWakes.has(actorId);
  }

  narratorWake(actorId: string): NarratorWakeReservation | undefined {
    return this.narratorWakes.get(actorId);
  }

  actorTurn(actorId: string): ActorTurnReservation | undefined {
    return this.actorTurns.get(actorId);
  }

  reserveActorTurn(actorId: string, reservation: ActorTurnReservation): void {
    this.actorTurns.set(actorId, reservation);
  }

  settleActorTurn(actorId: string): ActorTurnReservation | undefined {
    const reservation = this.actorTurns.get(actorId);
    this.actorTurns.delete(actorId);
    return reservation;
  }

  reserveNarratorWake(
    actorId: string,
    reservation: NarratorWakeReservation,
  ): boolean {
    if (this.narratorWakes.has(actorId)) return false;
    this.narratorWakes.set(actorId, reservation);
    return true;
  }

  settleNarratorWake(actorId: string, producedOutput: boolean): boolean {
    this.narratorWakes.delete(actorId);
    const wasAmbient = this.ambientWakes.delete(actorId);
    if (wasAmbient && producedOutput) this.ambientOutput = true;
    return wasAmbient;
  }

  markAmbientWake(actorId: string): void {
    this.ambientWakes.add(actorId);
  }

  clearAmbientWakes(): void {
    this.ambientWakes.clear();
  }

  markAmbientOutput(): void {
    this.ambientOutput = true;
  }

  resetAmbientCycle(): void {
    this.ambientWakes.clear();
    this.ambientOutput = false;
  }

  clear(): void {
    this.narratorWakes.clear();
    this.actorTurns.clear();
    this.resetAmbientCycle();
  }
}
