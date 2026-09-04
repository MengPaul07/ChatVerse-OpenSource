import type {
  NarrativeBeat,
  PlayerTurnProposal,
  WorldActorDefinition,
  WorldForegroundFailureKind,
  WorldForegroundOperation,
  WorldForegroundRecoveryState,
  WorldForegroundResponsibility,
  WorldNotificationPayloadMap,
  WorldNotificationType,
  PresentationTurnState,
} from "../../../contracts/world.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { ProviderFailureDetails } from "../../provider-failure.js";
import { providerFailureDetails } from "../../provider-failure.js";
import type { ChatContextRuntime } from "../runtime/context-runtime.js";
import type {
  ForegroundRecoveryIntent,
} from "../runtime/foreground-recovery.js";
import { errorToMessage } from "../runtime/helpers.js";
import { PlayerTurnAgent } from "./player.js";
import {
  buildWorldPlayerTurnView,
  type PlayerTurnViewBuilderOptions,
} from "./world-host.js";
import type { WorldState } from "../state.js";

interface PlayerTurnJob {
  beatId: string;
  controller: AbortController;
}

export interface PlayerTurnRuntimeHost {
  state: WorldState;
  runtime: RuntimeHost;
  playerAgent: PlayerTurnAgent;
  getContext(contextId: string): ChatContextRuntime;
  getActiveBeat(contextId: string): NarrativeBeat | undefined;
  playerActorId(contextId: string): string | undefined;
  requireActor(actorId: string): WorldActorDefinition;
  nextId(): string;
  lifecycleEpoch(): number;
  isActive(): boolean;
  expectForegroundOperation(input: {
    contextId: string;
    operation: WorldForegroundOperation;
    responsibility: WorldForegroundResponsibility;
    intent: ForegroundRecoveryIntent;
    expectedAt?: number;
    beatId?: string;
    actorId?: string;
  }): boolean;
  startForegroundOperation(contextId: string, operation: WorldForegroundOperation): void;
  clearForegroundOperation(contextId: string, operation: WorldForegroundOperation): void;
  failForegroundOperation(
    contextId: string,
    operation: WorldForegroundOperation,
    kind: WorldForegroundFailureKind,
    message: string,
    userMessage?: string,
    retryable?: boolean,
  ): void;
  retryOrFailForegroundOperation(
    contextId: string,
    operation: WorldForegroundOperation,
    kind: WorldForegroundFailureKind,
    message: string,
    retryDelayMs: number,
  ): void;
  handleBlockingProviderFailure(
    error: ProviderFailureDetails,
    source: { contextId?: string; operation: "player" },
  ): boolean;
  getRecovery(contextId: string): WorldForegroundRecoveryState | undefined;
  queuePlayerTurn(contextId: string, beatId: string, proposal?: PlayerTurnProposal): boolean;
  playerTurn(contextId: string, beatId: string): PresentationTurnState | undefined;
  playerProposal(contextId: string, beatId: string): PlayerTurnProposal | undefined;
  setPlayerProposal(contextId: string, beatId: string, proposal: PlayerTurnProposal): boolean;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/** Owns the Player Agent request and its foreground recovery state. */
export class PlayerTurnRuntime {
  private readonly jobs = new Map<string, PlayerTurnJob>();

  constructor(private readonly host: PlayerTurnRuntimeHost) {}

  prepare(
    contextId: string,
    beat: NarrativeBeat,
    prompt: string,
    guidance: string,
  ): void {
    const existingJob = this.jobs.get(contextId);
    if (existingJob?.beatId === beat.id) return;
    if (this.host.playerProposal(contextId, beat.id)) return;

    if (!this.host.expectForegroundOperation({
      contextId,
      operation: "player",
      responsibility: "prepare_player_turn",
      intent: {
        operation: "player",
        beatId: beat.id,
        prompt,
        guidance,
      },
      beatId: beat.id,
      actorId: this.host.playerActorId(contextId),
    })) return;

    existingJob?.controller.abort();

    const existingTurn = this.host.playerTurn(contextId, beat.id);
    if (!existingTurn && !this.host.queuePlayerTurn(contextId, beat.id)) {
      this.host.clearForegroundOperation(contextId, "player");
      return;
    }

    const controller = new AbortController();
    this.jobs.set(contextId, { beatId: beat.id, controller });
    const epoch = this.host.lifecycleEpoch();
    let proposal: PlayerTurnProposal | undefined;

    void this.run(contextId, beat, prompt, guidance, controller, epoch)
      .then((result) => {
        proposal = result;
      })
      .catch(() => {
        // Failure state and user-visible recovery are handled in run().
      })
      .finally(() => {
        if (this.jobs.get(contextId)?.controller === controller) {
          this.jobs.delete(contextId);
        }
        if (
          controller.signal.aborted ||
          epoch !== this.host.lifecycleEpoch() ||
          !this.host.isActive() ||
          this.host.getActiveBeat(contextId)?.id !== beat.id ||
          !proposal
        ) return;
        this.host.setPlayerProposal(contextId, beat.id, proposal);
      });
  }

  abort(contextId: string): void {
    this.jobs.get(contextId)?.controller.abort();
    this.jobs.delete(contextId);
  }

  abortAll(): void {
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }

  private async run(
    contextId: string,
    beat: NarrativeBeat,
    prompt: string,
    guidance: string,
    controller: AbortController,
    epoch: number,
  ): Promise<PlayerTurnProposal | undefined> {
    let proposal: PlayerTurnProposal | undefined;
    try {
      const viewOptions: PlayerTurnViewBuilderOptions = {
        state: this.host.state,
        getContext: (id) => this.host.getContext(id),
        playerActorId: (id) => this.host.playerActorId(id),
        requireActor: (id) => this.host.requireActor(id),
        nextId: () => this.host.nextId(),
      };
      const view = buildWorldPlayerTurnView(
        viewOptions,
        contextId,
        beat,
        prompt,
        guidance,
      );
      this.host.startForegroundOperation(contextId, "player");
      proposal = await this.host.playerAgent.propose(view, controller.signal);
      this.host.clearForegroundOperation(contextId, "player");
    } catch (error) {
      if (controller.signal.aborted || epoch !== this.host.lifecycleEpoch()) return undefined;
      const message = errorToMessage(error);
      const blocked = this.host.handleBlockingProviderFailure(providerFailureDetails(error), {
        contextId,
        operation: "player",
      });
      if (blocked) {
        this.host.failForegroundOperation(
          contextId,
          "player",
          "provider",
          message,
          "模型连接需要处理，修复配置后可重试玩家选项。",
          false,
        );
      } else {
        const failureKind: WorldForegroundFailureKind = message.includes("invalid")
          ? "protocol"
          : "provider";
        this.host.retryOrFailForegroundOperation(
          contextId,
          "player",
          failureKind,
          message,
          failureKind === "protocol" ? 0 : 5_000,
        );
        if (this.host.getRecovery(contextId)?.status === "failed") {
          this.host.notify("presentation.error", {
            contextId,
            beatId: beat.id,
            message,
          });
        }
      }
    }
    return proposal;
  }
}
