import type {
  PlayerPerformance,
  PlayerTurnProposal,
  PresentationAcknowledgementResult,
  PresentationParticipant,
  PresentationRuntimeSnapshot,
  PresentationTurnState,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";

export interface PresentationControllerHost {
  now(): number;
  nextId(): string;
  openingMinimumMs(contextId: string): number | undefined;
  playerActorId(contextId: string): string | undefined;
  prefetchLimit(contextId: string): number;
  commitPlayerPerformance(contextId: string, actorId: string, performance: PlayerPerformance): string[];
  onPlayerPerformanceCommitted(
    contextId: string,
    beatId: string,
    entryIds: string[],
    skipped: boolean,
  ): void;
  onPresentationAcknowledged(
    contextId: string,
    beatId: string,
    promoted: boolean,
    acknowledgedTurn: PresentationTurnState,
  ): void;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

interface PresentationEntry extends Omit<PresentationRuntimeSnapshot, "current" | "buffered"> {
  turns: PresentationTurnState[];
}

/**
 * Presentation is deliberately a dumb queue. It owns only the visible turn,
 * a bounded prefetched queue and the acknowledgement gate. Narrator owns routing.
 */
export class PresentationController {
  private readonly entries = new Map<string, PresentationEntry>();

  constructor(
    private readonly host: PresentationControllerHost,
    restored: readonly PresentationRuntimeSnapshot[] = [],
  ) {
    for (const snapshot of restored) {
      if (!snapshot.contextId) continue;
      this.entries.set(snapshot.contextId, restoreEntry(snapshot));
    }
  }

  snapshot(): PresentationRuntimeSnapshot[] {
    return [...this.entries.values()].map(snapshotEntry);
  }

  debug(contextId?: string): PresentationRuntimeSnapshot[] {
    return this.snapshot().filter((entry) => !contextId || entry.contextId === contextId);
  }

  startBeat(contextId: string, beatId: string): void {
    const current = this.entries.get(contextId);
    if (current?.beatId === beatId) return;
    this.entries.set(contextId, {
      contextId,
      beatId,
      status: "idle",
      mode: current?.mode ?? "world",
      prefetchLimit: this.host.prefetchLimit(contextId),
      ...(current?.normalPacingMultiplier != null
        ? { normalPacingMultiplier: current.normalPacingMultiplier }
        : {}),
      turns: [],
      openingNarrationPending: true,
    });
  }

  hasEntry(contextId: string): boolean {
    return this.entries.has(contextId);
  }

  hasAwaitingPlayer(contextId: string): boolean {
    const entry = this.entries.get(contextId);
    return entry?.turns.some((turn) => turn.status === "waiting_player") === true;
  }

  current(contextId: string): PresentationTurnState | undefined {
    const turn = this.entries.get(contextId)?.turns[0];
    return turn ? cloneTurn(turn) : undefined;
  }

  playerTurn(contextId: string, beatId: string): PresentationTurnState | undefined {
    const entry = this.entries.get(contextId);
    const turn = entry?.turns.find((candidate) => (
      candidate?.beatId === beatId &&
      candidate.status === "waiting_player" &&
      candidate.participant.type === "player"
    ));
    return turn ? cloneTurn(turn) : undefined;
  }

  playerProposal(contextId: string, beatId: string): PlayerTurnProposal | undefined {
    const entry = this.entries.get(contextId);
    if (!entry || !this.playerTurn(contextId, beatId)) return undefined;
    return entry.playerProposal ? structuredClone(entry.playerProposal) : undefined;
  }

  latestQueuedParticipant(contextId: string): PresentationParticipant | undefined {
    const entry = this.entries.get(contextId);
    const participant = entry?.turns.at(-1)?.participant;
    return participant ? cloneParticipant(participant) : undefined;
  }

  mode(contextId: string): "world" | "stage" {
    return this.entries.get(contextId)?.mode ?? "world";
  }

  setMode(
    contextId: string,
    mode: "world" | "stage",
    normalPacingMultiplier?: number,
  ): void {
    let entry = this.entries.get(contextId);
    if (!entry) {
      entry = {
        contextId,
        beatId: "",
        status: "idle",
        mode: "world",
        prefetchLimit: this.host.prefetchLimit(contextId),
        turns: [],
        openingNarrationPending: true,
      };
      this.entries.set(contextId, entry);
    }
    entry.mode = mode;
    entry.prefetchLimit = this.host.prefetchLimit(contextId);
    if (normalPacingMultiplier != null) {
      entry.normalPacingMultiplier = normalPacingMultiplier;
    }
  }

  setPrefetchLimit(contextId: string, value: number): void {
    const entry = this.entries.get(contextId);
    if (!entry) return;
    entry.prefetchLimit = Math.max(0, Math.round(value));
  }

  canPrefetch(contextId: string): boolean {
    const entry = this.entries.get(contextId);
    if (!entry || this.hasAwaitingPlayer(contextId)) return false;
    return bufferedCount(entry) < entry.prefetchLimit;
  }

  setTimingBypass(contextId: string, enabled: boolean): void {
    if (!enabled) return;
    const entry = this.entries.get(contextId);
    if (!entry) return;
    for (const turn of entry.turns) turn.acknowledgeAfter = undefined;
  }

  /** Queue an already committed narration, Actor output or player performance. */
  queueTurn(
    contextId: string,
    beatId: string,
    participant: PresentationParticipant,
    entryIds: readonly string[],
  ): boolean {
    if (entryIds.length === 0) return false;
    const entry = this.ensureEntry(contextId, beatId);
    if (entry.turns.length > 0 && bufferedCount(entry) >= entry.prefetchLimit) return false;
    if (entry.turns.some((turn) => (
      turn.beatId === beatId &&
      sameParticipant(turn.participant, participant) &&
      sameEntryIds(turn.entryIds, entryIds)
    ))) return false;
    const turn: PresentationTurnState = {
      turnToken: this.host.nextId(),
      contextId,
      beatId,
      participant: cloneParticipant(participant),
      entryIds: [...entryIds],
      status: "waiting_ack",
      ...(participant.type === "narration" && entry.openingNarrationPending
        ? { acknowledgeAfter: this.host.now() + (this.host.openingMinimumMs(contextId) ?? 0) }
        : {}),
    };
    if (participant.type === "narration") entry.openingNarrationPending = false;
    const buffered = entry.turns.length > 0;
    entry.turns.push(turn);
    entry.status = "waiting_ack";
    this.notifyTurnQueued(entry, turn, buffered);
    return true;
  }

  /** Queue the player gate. A gate may sit behind the visible narration. */
  queuePlayerTurn(
    contextId: string,
    beatId: string,
    proposal?: PlayerTurnProposal,
  ): boolean {
    const playerActorId = this.host.playerActorId(contextId);
    if (!playerActorId) return false;
    const entry = this.ensureEntry(contextId, beatId);
    if (this.playerTurn(contextId, beatId)) return false;
    // The player gate is a reservation, not a generated turn. It may sit one
    // position beyond the prefetch window; hasAwaitingPlayer() stops further
    // generation until the gate is consumed.
    const turn: PresentationTurnState = {
      turnToken: this.host.nextId(),
      contextId,
      beatId,
      participant: { type: "player", actorId: playerActorId },
      entryIds: [],
      status: "waiting_player",
    };
    const buffered = entry.turns.length > 0;
    entry.turns.push(turn);
    entry.playerProposal = proposal ? structuredClone(proposal) : undefined;
    entry.status = "waiting_player";
    this.host.notify("presentation.turn_queued", {
      contextId,
      beatId,
      participant: turn.participant,
      entryIds: [],
      ...(buffered ? { buffered: true } : {}),
    });
    this.host.notify("presentation.waiting_player", {
      contextId,
      beatId,
      turn: cloneTurn(turn),
      ...(proposal ? { proposal: structuredClone(proposal) } : {}),
      ...(buffered ? { buffered: true } : {}),
    });
    return true;
  }

  setPlayerProposal(contextId: string, beatId: string, proposal: PlayerTurnProposal): boolean {
    const entry = this.entries.get(contextId);
    const turn = this.playerTurn(contextId, beatId);
    if (!entry || !turn || turn.status !== "waiting_player") return false;
    entry.playerProposal = structuredClone(proposal);
    if (entry.turns[0]?.turnToken === turn.turnToken) this.notifyCurrent(entry);
    return true;
  }

  acknowledgePresentation(contextId: string, turnToken: string): PresentationAcknowledgementResult {
    const entry = this.entries.get(contextId);
    if (!entry) return "stale";
    if (entry.lastAcknowledgedTurnToken === turnToken) return "accepted";
    const current = entry.turns[0];
    if (!current || current.status !== "waiting_ack" || current.turnToken !== turnToken) return "stale";
    if (current.acknowledgeAfter != null && this.host.now() < current.acknowledgeAfter) return "too_early";
    entry.lastAcknowledgedTurnToken = turnToken;
    entry.turns.shift();
    const next = entry.turns[0];
    if (next?.status !== "waiting_player" && !entry.turns.some((turn) => turn.status === "waiting_player")) {
      entry.playerProposal = undefined;
    }
    entry.status = next?.status ?? "idle";
    this.host.notify("presentation.acknowledged", {
      contextId,
      beatId: entry.beatId,
      turnToken,
      ...(next ? { nextTurnToken: next.turnToken } : {}),
    });
    if (next) {
      this.notifyCurrent(entry);
    }
    this.host.onPresentationAcknowledged(
      contextId,
      entry.beatId,
      Boolean(next),
      cloneTurn(current),
    );
    return "accepted";
  }

  submitPlayerTurn(
    contextId: string,
    actorId: string,
    proposalId: string | undefined,
    performance: PlayerPerformance | undefined,
    skip = false,
  ): boolean {
    const entry = this.entries.get(contextId);
    const current = entry?.turns[0];
    if (!entry || !current || current.status !== "waiting_player" ||
      current.participant.type !== "player" || current.participant.actorId !== actorId) return false;
    if (proposalId && entry.playerProposal?.id !== proposalId) return false;
    if (skip) {
      entry.turns.shift();
      entry.playerProposal = undefined;
      entry.status = entry.turns[0]?.status ?? "idle";
      this.host.onPlayerPerformanceCommitted(contextId, entry.beatId, [], true);
      if (entry.turns[0]) this.notifyCurrent(entry);
      return true;
    }
    if (!performance || (!performance.message?.trim() && !performance.action?.trim())) return false;
    const entryIds = this.host.commitPlayerPerformance(contextId, actorId, performance);
    if (entryIds.length === 0) return false;
    const turn: PresentationTurnState = {
      turnToken: this.host.nextId(),
      contextId,
      beatId: entry.beatId,
      participant: { type: "player", actorId },
      entryIds,
      status: "waiting_ack",
    };
    entry.turns[0] = turn;
    entry.playerProposal = undefined;
    entry.status = "waiting_ack";
    this.notifyTurnQueued(entry, turn, false);
    this.host.onPlayerPerformanceCommitted(contextId, entry.beatId, entryIds, false);
    return true;
  }

  clearContext(contextId: string): void {
    const entry = this.entries.get(contextId);
    if (!entry) return;
    entry.status = "idle";
    entry.turns = [];
    entry.playerProposal = undefined;
    entry.openingNarrationPending = true;
  }

  /** Clear an interrupted scene without treating the next item as a new Beat opening. */
  interruptContext(contextId: string): void {
    const entry = this.entries.get(contextId);
    if (!entry) return;
    entry.status = "idle";
    entry.turns = [];
    entry.playerProposal = undefined;
    entry.openingNarrationPending = false;
  }

  clearBuffered(contextId: string): void {
    const entry = this.entries.get(contextId);
    if (!entry) return;
    const hasPlayerTurn = entry.turns.some((turn) => turn.status === "waiting_player");
    entry.turns = entry.turns.slice(0, 1);
    if (hasPlayerTurn) entry.playerProposal = undefined;
  }

  stop(): void {
    this.entries.clear();
  }

  private ensureEntry(contextId: string, beatId: string): PresentationEntry {
    const current = this.entries.get(contextId);
    if (current?.beatId === beatId) return current;
    const entry: PresentationEntry = {
      contextId,
      beatId,
      status: "idle",
      mode: current?.mode ?? "world",
      prefetchLimit: this.host.prefetchLimit(contextId),
      ...(current?.normalPacingMultiplier != null
        ? { normalPacingMultiplier: current.normalPacingMultiplier }
        : {}),
      turns: [],
      openingNarrationPending: true,
    };
    this.entries.set(contextId, entry);
    return entry;
  }

  private notifyTurnQueued(entry: PresentationEntry, turn: PresentationTurnState, buffered: boolean): void {
    this.host.notify("presentation.turn_queued", {
      contextId: entry.contextId,
      beatId: entry.beatId,
      participant: turn.participant,
      entryIds: [...turn.entryIds],
      ...(buffered ? { buffered: true } : {}),
    });
    this.notifyCurrent(entry, buffered);
  }

  private notifyCurrent(entry: PresentationEntry, buffered = false): void {
    const turn = buffered ? entry.turns.at(-1) : entry.turns[0];
    if (!turn) return;
    if (turn.status === "waiting_player") {
      this.host.notify("presentation.waiting_player", {
        contextId: entry.contextId,
        beatId: entry.beatId,
        turn: cloneTurn(turn),
        ...(entry.playerProposal ? { proposal: structuredClone(entry.playerProposal) } : {}),
        ...(buffered ? { buffered: true } : {}),
      });
      return;
    }
    this.host.notify("presentation.waiting_ack", {
      contextId: entry.contextId,
      beatId: entry.beatId,
      turn: cloneTurn(turn),
      ...(buffered ? { buffered: true } : {}),
    });
  }
}

function cloneParticipant(participant: PresentationParticipant): PresentationParticipant {
  return { ...participant };
}

function sameParticipant(
  left: PresentationParticipant,
  right: PresentationParticipant,
): boolean {
  if (left.type !== right.type) return false;
  return left.type === "actor" && right.type === "actor"
    ? left.actorId === right.actorId
    : left.type === "player" && right.type === "player"
      ? left.actorId === right.actorId
      : true;
}

function sameEntryIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function cloneTurn(turn: PresentationTurnState): PresentationTurnState {
  return {
    ...turn,
    participant: cloneParticipant(turn.participant),
    entryIds: [...turn.entryIds],
  };
}

function restoreEntry(snapshot: PresentationRuntimeSnapshot): PresentationEntry {
  const { current, buffered, ...entry } = snapshot;
  return {
    ...entry,
    turns: [current, ...buffered]
      .filter((turn): turn is PresentationTurnState => Boolean(turn))
      .map(cloneTurn),
    playerProposal: snapshot.playerProposal ? structuredClone(snapshot.playerProposal) : undefined,
  };
}

function snapshotEntry(entry: PresentationEntry): PresentationRuntimeSnapshot {
  const { turns, ...snapshot } = entry;
  return {
    ...snapshot,
    current: turns[0] ? cloneTurn(turns[0]) : undefined,
    buffered: turns.slice(1).map(cloneTurn),
    playerProposal: entry.playerProposal ? structuredClone(entry.playerProposal) : undefined,
  };
}

function bufferedCount(entry: PresentationEntry): number {
  return Math.max(0, entry.turns.length - 1);
}
