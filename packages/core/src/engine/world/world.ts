import type {
  ActorAction,
  ChatMessage,
} from "../../contracts/chat.js";
import type {
  ChatProvider,
  ProviderUsageEventListener,
} from "../../contracts/provider.js";
import type {
  ActorMemoryNode,
  ActorMemoryRecallQuery,
  ActorMemorySlice,
  ActorMemorySnapshot,
} from "../../contracts/actor-memory.js";
import type {
  CreateWorldOptions,
  NarrativeBeat,
  ResolvedWorldActorMemoryPolicy,
  ResolvedWorldDirectorPolicy,
  WorldActorDefinition,
  WorldActorBackgroundState,
  PresentationAcknowledgementResult,
  WorldContextDefinition,
  WorldCreateChatContextInput,
  WorldDefinition,
  WorldEvent,
  WorldEventInput,
  WorldEventListener,
  WorldExternalEventInput,
  WorldDirectionInput,
  WorldMessageInput,
  WorldSubmitPlayerTurnInput,
  WorldAcknowledgePresentationInput,
  WorldUpdatePlayerCardInput,
  WorldNotificationListener,
  WorldNotificationPayloadMap,
  WorldNotificationType,
  WorldProgressionInput,
  WorldRecordActorMemoryInput,
  WorldRegisterActorInput,
  WorldReviseActorMemoryInput,
  WorldSetActorParticipationInput,
  WorldSetActorPresenceInput,
  WorldSnapshot,
  WorldUnsubscribe,
  WorldUpdateActorControlPolicyInput,
  WorldForegroundRecoveryState,
  WorldRetryForegroundOperationInput,
  WorldDismissForegroundFailureInput,
} from "../../contracts/world.js";
import type { RuntimeHost } from "../../runtime/types.js";
import { ActorGenerationCoordinator } from "./actor-coordinator.js";
import {
  ActorMemoryUpdateCoordinator,
  InMemoryActorMemoryStore,
} from "../actor-memory/index.js";
import { WorldDirector } from "./director/index.js";
import {
  WorldNarrator,
  type NarratorMode,
  type NarratorDirectorRequest,
  type NarratorResult,
} from "./narrator/index.js";
import { PlayerTurnAgent } from "./presentation/player.js";
import { PlayerTurnRuntime } from "./presentation/player-turn-runtime.js";
import { PresentationController } from "./presentation/controller.js";
import { ContextPresentationRuntime } from "./presentation/context-presentation.js";
import {
  createWorldPresentationHost,
} from "./presentation/world-host.js";
import type {
  WorldDirectorMutation,
  WorldDirectorTaskMode,
} from "./director/index.js";
import { WorldState } from "./state.js";
import { WorldDebugEmitter, type WorldDebugListener } from "../../observability/world-debug/index.js";
import type { WorldDebugSnapshot } from "../../contracts/world-debug.js";
import {
  observeProviderUsage,
} from "../../observability/provider-usage.js";
import { observeProviderSession } from "../../observability/provider-session.js";
import {
  providerFailureDetails,
} from "../provider-failure.js";
import {
  clampInteger,
  resolveWorldActorMemoryPolicy,
  resolveWorldDirectorPolicy,
  type ResolvedBeatRuntimeConfig,
} from "./runtime/config.js";
import {
  isConversationContext,
  isPlayerControlledActor,
  isPrivateConversationContext,
  normalizeWorldDefinition,
} from "./persistence/definition.js";
import {
  ForegroundRecoveryController,
} from "./runtime/foreground-recovery.js";
import { ForegroundOperationsRuntime } from "./runtime/foreground-operations.js";
import { WorldDirectorSupportRuntime } from "./runtime/director-support.js";
import { WorldEventRecorder } from "./runtime/event-recorder.js";
import {
  cloneMessage,
} from "./runtime/helpers.js";
import { WorldSourceHost } from "./hosts/source-host.js";
import { WorldInspectionHost } from "./hosts/inspection-host.js";
import { createWorldDirectorHost } from "./hosts/director-host.js";
import { NarratorViewBuilder } from "./hosts/narrator-view.js";
import { DirectorViewBuilder } from "./hosts/director-view.js";
import { DirectorTaskBuilder } from "./hosts/director-task.js";
import {
  type ChatContextRuntime,
} from "./runtime/context-runtime.js";
import { WorldContextRuntimeFactory } from "./runtime/context-factory.js";
import { ContextActivityController } from "./runtime/context-activity.js";
import { WorldProjectionRuntime } from "./projections/world-projection.js";
import { WorldMemoryRuntime } from "./runtime/memory-runtime.js";
import { WorldMemoryCommands } from "./runtime/memory-commands.js";
import { TimelineRuntime } from "./runtime/timeline-runtime.js";
import { DirectorRuntime } from "./runtime/director-runtime.js";
import { NarratorRuntime } from "./runtime/narrator-runtime.js";
import { NarratorResultApplier } from "./runtime/narrator-result.js";
import { DirectorMutationApplier } from "./runtime/director-mutations.js";
import {
  ActorRuntimeBridge,
} from "./runtime/actor-runtime.js";
import { ActorPresenceRuntime } from "./runtime/actor-presence.js";
import { ActorCommandsRuntime } from "./runtime/actor-commands.js";
import { ActorRegistryRuntime } from "./runtime/actor-registry.js";
import { ConversationContextCreator } from "./runtime/conversation-context.js";
import { WorldEventRuntime } from "./runtime/world-event-runtime.js";
import { WorldDiagnosticsRuntime } from "./runtime/diagnostics.js";
import { WorldNotificationRuntime } from "./runtime/notifications.js";
import { ContextLifecycleRuntime } from "./runtime/context-lifecycle.js";
import {
  WorldLifecycleRuntime,
  type WorldLifecycleStatus,
} from "./runtime/lifecycle.js";
import {
  minimumBeatActorTurns,
} from "./narrative/beat-metrics.js";
import { BeatCompletionRuntime } from "./narrative/beat-completion.js";

export type WorldStatus = WorldLifecycleStatus;

export class World {
  private readonly state: WorldState;
  private readonly directorRuntime: DirectorRuntime;
  private readonly narratorRuntime: NarratorRuntime;
  private readonly narratorResultApplier: NarratorResultApplier;
  private readonly directorMutationApplier: DirectorMutationApplier;
  private readonly directorSupport: WorldDirectorSupportRuntime;
  private readonly eventRecorder: WorldEventRecorder;
  private readonly actorRuntimeBridge: ActorRuntimeBridge;
  private readonly actorPresenceRuntime: ActorPresenceRuntime;
  private readonly actorCommands: ActorCommandsRuntime;
  private readonly actorRegistry: ActorRegistryRuntime;
  private readonly conversationContextCreator: ConversationContextCreator;
  private readonly eventRuntime: WorldEventRuntime;
  private readonly playerTurnRuntime: PlayerTurnRuntime;
  private readonly presentation: PresentationController;
  private readonly beatCompletion: BeatCompletionRuntime;
  private readonly policy: ResolvedWorldDirectorPolicy;
  private readonly actorMemoryPolicy: ResolvedWorldActorMemoryPolicy;
  private readonly actorCoordinator = new ActorGenerationCoordinator();
  private readonly actorMemory: InMemoryActorMemoryStore;
  private readonly memoryRuntime: WorldMemoryRuntime;
  private readonly memoryCommands: WorldMemoryCommands;
  private readonly actorMemoryUpdates: ActorMemoryUpdateCoordinator;
  private readonly diagnostics: WorldDiagnosticsRuntime;
  private readonly debug: WorldDebugEmitter;
  private readonly notifications: WorldNotificationRuntime;
  private readonly recovery: ForegroundRecoveryController;
  private readonly foregroundOperations: ForegroundOperationsRuntime;
  private readonly lifecycle: WorldLifecycleRuntime;
  private readonly timelineRuntime: TimelineRuntime;
  private readonly sourceProvider: CreateWorldOptions["sourceProvider"];
  private readonly sourceHost: WorldSourceHost;
  private readonly inspection: WorldInspectionHost;
  private readonly directorViewBuilder: DirectorViewBuilder;
  private readonly directorTaskBuilder: DirectorTaskBuilder;
  private readonly narratorViewBuilder: NarratorViewBuilder;
  private readonly projections: WorldProjectionRuntime;
  private readonly contextRuntimes = new Map<string, ChatContextRuntime>();
  private readonly contextRuntimeFactory: WorldContextRuntimeFactory;
  private readonly contextLifecycle: ContextLifecycleRuntime;
  private readonly contextActivity: ContextActivityController;
  private statusValue: WorldStatus = "idle";
  private lifecycleEpoch = 0;
  private readonly contextPresentation: ContextPresentationRuntime;

  constructor(
    definitionInput: WorldDefinition,
    private readonly directorProvider: ChatProvider,
    private readonly characterProvider: ChatProvider,
    private readonly runtime: RuntimeHost,
    options: CreateWorldOptions = {},
  ) {
    if (options.snapshot && options.snapshot.schemaVersion !== 7) {
      throw new Error(`Unsupported World snapshot schema: ${String(options.snapshot.schemaVersion)}`);
    }
    const definition = normalizeWorldDefinition(definitionInput);
    this.sourceProvider = options.sourceProvider;
    this.sourceHost = new WorldSourceHost(definition.sources ?? [], options.sourceProvider);
    if (definition.sources?.length) {
      if (!this.sourceProvider) {
        throw new Error("World Source bindings require a WorldSourceProvider.");
      }
      const sourceErrors = this.sourceProvider.validate(definition.sources);
      if (sourceErrors.length > 0) {
        throw new Error(`Invalid World Source bindings: ${sourceErrors.join("; ")}`);
      }
    }
    if (options.snapshot && options.snapshot.worldId !== definition.metadata.id) {
      throw new Error(`World snapshot mismatch: expected ${definition.metadata.id}, got ${options.snapshot.worldId}`);
    }
    this.policy = resolveWorldDirectorPolicy(
      definition.directorPolicy,
      options.directorPolicy,
    );
    this.actorMemoryPolicy = resolveWorldActorMemoryPolicy(
      definition.actorMemoryPolicy,
      options.actorMemoryPolicy,
    );
    this.state = new WorldState(definition, runtime, options.snapshot);
    this.directorSupport = new WorldDirectorSupportRuntime({
      state: this.state,
      policy: this.policy,
      now: () => this.now(),
      isStopped: () => this.statusValue === "stopped",
      hasContext: (contextId) => this.contextRuntimes.has(contextId),
      requireActor: (actorId) => this.requireActor(actorId),
      appendEvent: (input) => this.appendEvent(input),
    });
    this.inspection = new WorldInspectionHost({
      state: this.state,
      getContextMessages: (contextId) => this.getContextMessages(contextId),
      getActorGenerationStatus: (actorId) => this.actorCoordinator.getStatus(actorId),
      getActorWakeStatus: (contextId, actorId) => {
        const context = this.contextRuntimes.get(contextId);
        const characterName = context?.actorNameById.get(actorId);
        return characterName
          ? context?.session.getCharacterWakeStatus(characterName) ?? "unavailable"
          : "unavailable";
      },
    });
    this.directorViewBuilder = new DirectorViewBuilder({
      state: this.state,
      actorCoordinator: this.actorCoordinator,
      sourceProvider: this.sourceProvider,
    });
    this.directorTaskBuilder = new DirectorTaskBuilder(this.state);
    this.diagnostics = new WorldDiagnosticsRuntime(options.debug, definition.metadata.id, runtime);
    this.debug = this.diagnostics.emitter;
    if (this.debug.enabled) {
      this.directorProvider = observeProviderSession(
        this.directorProvider,
        (event) => this.diagnostics.traceProviderSession(event),
        () => this.runtime.clock.now(),
      );
      this.characterProvider = observeProviderSession(
        this.characterProvider,
        (event) => this.diagnostics.traceProviderSession(event),
        () => this.runtime.clock.now(),
      );
    }
    this.notifications = new WorldNotificationRuntime(
      definition.metadata.id,
      () => this.now(),
      this.debug,
    );
    this.contextActivity = new ContextActivityController({
      state: this.state,
      contextRuntimes: this.contextRuntimes,
      runtime: this.runtime,
      contextSuspendAfterMs: this.policy.contextSuspendAfterMs,
      isConversationContext,
      isPlayerControlledActor: (actorId) => {
        const actor = this.state.actorDefinitions.get(actorId);
        return actor ? isPlayerControlledActor(actor) : false;
      },
      host: {
        isRunning: () => this.statusValue === "running",
        isStopped: () => this.statusValue === "stopped",
        notify: (type, payload) => this.notify(
          type as WorldNotificationType,
          payload as WorldNotificationPayloadMap[WorldNotificationType],
        ),
        onAmbientDue: (contextId, noopCount) => {
          const ambientEvent = this.appendEvent({
            type: "world.progression.requested",
            contextId,
            payload: { reason: "ambient" },
          });
          this.notify("context.ambient_triggered", {
            contextId,
            noopCount,
          });
          const activeBeat = this.activeBeatForContext(contextId);
          if (activeBeat) {
            this.maybeScheduleBeatClosureCheck(contextId, activeBeat.id, true, [ambientEvent.id]);
          } else {
            this.scheduleDirector(true, "ambient");
          }
        },
        onSuspendDue: (contextId) => this.suspendContext(contextId),
      },
    });
    this.recovery = new ForegroundRecoveryController(runtime, {
      isRunning: () => this.statusValue === "running",
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
      abort: (contextId, operation) => this.foregroundOperations.abort(contextId, operation),
      execute: (contextId, intent) => this.foregroundOperations.executeRecovery(contextId, intent),
      settleDismissedActor: (contextId, actorId) => {
        this.actorRuntimeBridge.settleDismissedActor(contextId, actorId);
      },
    }, options.snapshot?.foregroundRecovery, this.policy.maxProviderRetries);
    this.foregroundOperations = new ForegroundOperationsRuntime({
      recovery: this.recovery,
      isRunning: () => this.statusValue === "running",
      now: () => this.now(),
      getContextRuntime: (contextId) => this.contextRuntimes.get(contextId),
      getActiveBeat: (contextId) => this.activeBeatForContext(contextId),
      getBeat: (beatId) => this.state.beats.get(beatId),
      isConversationContext: (context) => isConversationContext(context.definition),
      requestActorWake: (input) => this.actorRuntimeBridge.requestActorWake(input),
      preparePlayerTurn: (contextId, beat, prompt, guidance) => {
        this.playerTurnRuntime.prepare(contextId, beat, prompt, guidance);
      },
      abortPlayerTurn: (contextId) => {
        this.playerTurnRuntime.abort(contextId);
      },
      interruptActorWork: (contextId) => {
        this.contextRuntimes.get(contextId)?.session.interruptPendingActorWork("foreground retry");
      },
      abortDirector: () => this.directorRuntime.abort(),
      abortNarrator: (contextId) => this.narratorRuntime.abort(contextId),
      pauseContext: (contextId) => this.pauseContext(contextId, "manual"),
      pauseWorld: () => this.pause(),
      scheduleDirector: (immediate, reason) => this.scheduleDirector(immediate, reason),
      scheduleNarrator: (contextId, mode, sourceEventIds, delayMs, direction) => (
        this.scheduleNarrator(contextId, mode, sourceEventIds, delayMs, direction)
      ),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.timelineRuntime = new TimelineRuntime({
      provider: this.characterProvider,
      minRows: clampInteger(
        options.timelineCuratorMinRows,
        32,
        1,
        1_000,
      ),
      restored: options.snapshot?.contextTimelineCheckpoints,
      host: {
        readContextEvents: (contextId) => this.state.journal.all()
          .filter((event) => event.contextId === contextId),
        readActorJoinedAt: (contextId, actorId) => (
          this.state.getPresence(contextId, actorId)?.joinedAtSequence ?? 0
        ),
        now: () => this.runtime.clock.now(),
        lifecycleEpoch: () => this.lifecycleEpoch,
        isStopped: () => this.statusValue === "stopped",
        onProviderError: (contextId, error) => {
          this.foregroundOperations.handleBlockingProviderFailure(providerFailureDetails(error), {
            contextId,
            operation: "compression",
          });
        },
      },
    });
    const observedDirectorProvider = observeProviderUsage(
      this.directorProvider,
      (observation) => this.diagnostics.traceProviderUsage("world_director", observation),
    );
    const observedMemoryProvider = observeProviderUsage(
      this.characterProvider,
      (observation) => this.diagnostics.traceProviderUsage("actor_memory", observation),
    );
    const observedNarratorProvider = observeProviderUsage(
      this.characterProvider,
      (observation) => this.diagnostics.traceProviderUsage("world_narrator", observation),
    );
    const observedPlayerProvider = observeProviderUsage(
      this.characterProvider,
      (observation) => this.diagnostics.traceProviderUsage("player_actor", observation),
    );
    this.actorMemory = new InMemoryActorMemoryStore(
      [...this.state.actorDefinitions.values()].map((actor) => ({
        actorId: actor.id,
        definition: actor.memory,
        snapshot: options.snapshot?.actorMemories?.find((memory) => memory.actorId === actor.id),
      })),
      runtime,
    );
    this.memoryRuntime = new WorldMemoryRuntime({
      state: this.state,
      store: this.actorMemory,
      policy: this.actorMemoryPolicy,
      contextRuntimes: this.contextRuntimes,
      getActiveBeat: (contextId) => this.activeBeatForContext(contextId),
      isStopped: () => this.statusValue === "stopped",
      appendMemoryUpdate: (commit, sourceEvents) => {
        this.appendEvent({
          type: "actor.memory.updated",
          actorId: commit.actorId,
          causationId: sourceEvents[sourceEvents.length - 1]?.id,
          payload: {
            idempotencyKey: commit.idempotencyKey,
            fromRevision: commit.fromRevision,
            toRevision: commit.toRevision,
            createdNodeIds: commit.createdNodeIds,
            revisedNodeIds: commit.revisedNodeIds,
            deletedNodeIds: commit.deletedNodeIds,
            createdEdgeIds: commit.createdEdgeIds,
            deletedEdgeIds: commit.deletedEdgeIds,
            sourceEventIds: sourceEvents.map((event) => event.id),
          },
        });
      },
      appendRelationEvent: (event) => {
        if (event.type === "relation.updated") {
          this.appendEvent({
            type: event.type,
            actorId: event.actorId,
            causationId: event.causationId,
            payload: event.payload,
          });
        } else {
          this.appendEvent({
            type: event.type,
            actorId: event.actorId,
            causationId: event.causationId,
            payload: event.payload,
          });
        }
      },
      syncContextRoster: (contextId) => this.actorRuntimeBridge.syncContextRoster(contextId),
    });
    this.memoryRuntime.initializeRelations();
    this.actorMemoryUpdates = new ActorMemoryUpdateCoordinator({
      actors: [...this.state.actorDefinitions.values()]
        .filter((actor) => !isPlayerControlledActor(actor))
        .map((actor) => ({ actorId: actor.id, card: actor.card })),
      provider: observedMemoryProvider,
      store: this.actorMemory,
      runtime,
      policy: this.actorMemoryPolicy,
      restored: options.snapshot?.actorMemoryRuntime,
      getEvent: (eventId) => this.state.journal.get(eventId),
      recall: (actorId, events) => this.memoryRuntime.recallForEvents(actorId, events),
      onCommit: (commit, events) => this.memoryRuntime.commitAutomaticUpdate(commit, events),
      onProviderError: (error) => this.foregroundOperations.handleBlockingProviderFailure(error, {
        operation: "memory",
      }),
      notify: (type, payload) => this.notify(type, payload),
      trace: (event) => this.diagnostics.traceActorMemory(event),
    });
    this.eventRecorder = new WorldEventRecorder({
      state: this.state,
      debug: this.debug,
      actorMemoryUpdates: this.actorMemoryUpdates,
      requireActor: (actorId) => this.requireActor(actorId),
    });
    this.memoryCommands = new WorldMemoryCommands({
      actorMemory: this.actorMemory,
      memoryRuntime: this.memoryRuntime,
      assertNotStopped: (operation) => this.assertNotStopped(operation),
      requireActor: (actorId) => { this.requireActor(actorId); },
      assertMemorySourcesExist: (sourceEventIds) => this.assertMemorySourcesExist(sourceEventIds),
      appendEvent: (input) => this.appendEvent(input),
    });
    this.actorRegistry = new ActorRegistryRuntime({
      state: this.state,
      actorMemory: this.actorMemory,
      actorMemoryUpdates: this.actorMemoryUpdates,
      now: () => this.now(),
      isStopped: () => this.statusValue === "stopped",
      requireActor: (actorId) => this.requireActor(actorId),
      appendEvent: (input) => this.appendEvent(input),
      considerDirectorWork: (immediate) => this.considerDirectorWork(immediate),
    });
    this.actorCommands = new ActorCommandsRuntime({
      state: this.state,
      contextRuntimes: this.contextRuntimes,
      actorRegistry: this.actorRegistry,
      actorPresence: {
        transitionActorPresence: (input) => this.actorPresenceRuntime.transitionActorPresence(input),
        transitionActorParticipation: (input) => this.actorPresenceRuntime.transitionActorParticipation(input),
        updateActorControlPolicy: (input) => this.actorPresenceRuntime.updateActorControlPolicy(input),
      },
      actorRuntimeBridge: {
        syncContextRoster: (contextId) => this.actorRuntimeBridge.syncContextRoster(contextId),
      },
      requireActor: (actorId) => this.requireActor(actorId),
      requireContext: (contextId) => this.requireContext(contextId),
      assertNotStopped: (operation) => this.assertNotStopped(operation),
      assertMessageInputAllowed: (context) => this.assertMessageInputAllowed(context),
      activateContext: (contextId) => this.activateContext(contextId),
      scheduleContextSuspend: (contextId) => this.scheduleContextSuspend(contextId),
    });
    const director = new WorldDirector(observedDirectorProvider, this.policy);
    const narrator = new WorldNarrator(
      observedNarratorProvider,
      (event) => this.diagnostics.traceNarrator(event),
    );
    this.presentation = new PresentationController(
      createWorldPresentationHost({
        now: () => this.now(),
        nextId: () => this.runtime.idGenerator.next(),
        isStagePacingOverride: (contextId) => this.contextPresentation?.isStagePacingOverride(contextId) ?? false,
        getContext: (contextId) => this.requireContext(contextId),
        playerActorId: (contextId) => this.actorCommands.playerActorIdForContext(contextId),
        prefetchLimit: (contextId) => this.requireContext(contextId).beatRuntime.presentationPrefetchLimit,
        commitPlayerPerformance: (contextId, actorId, performance) => (
          this.actorRuntimeBridge.commitPlayerPerformance(contextId, actorId, performance)
        ),
        scheduleNarrator: (contextId, mode, sourceEventIds) => (
          this.scheduleNarrator(contextId, mode, sourceEventIds)
        ),
        scheduleDirector: (immediate, reason) => this.scheduleDirector(immediate, reason),
        activatePreparedBeat: (contextId) => this.directorMutationApplier.activatePreparedBeat(contextId),
        getBeat: (beatId) => this.state.beats.get(beatId),
        notify: (type, payload) => this.notify(
          type as WorldNotificationType,
          payload as WorldNotificationPayloadMap[WorldNotificationType],
        ),
      }),
      options.snapshot?.presentationRuntime,
    );
    this.contextPresentation = new ContextPresentationRuntime({
      presentation: this.presentation,
      getContext: (contextId) => this.requireContext(contextId),
      getActiveBeat: (contextId) => this.activeBeatForContext(contextId),
      getStatus: () => this.statusValue,
      assertNotStopped: (operation) => this.assertNotStopped(operation),
      scheduleNarrator: (contextId) => this.scheduleNarrator(contextId, "check_closure", [], 0),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.playerTurnRuntime = new PlayerTurnRuntime({
      state: this.state,
      runtime: this.runtime,
      playerAgent: new PlayerTurnAgent(observedPlayerProvider),
      getContext: (contextId) => this.requireContext(contextId),
      getActiveBeat: (contextId) => this.activeBeatForContext(contextId),
      playerActorId: (contextId) => this.actorCommands.playerActorIdForContext(contextId),
      requireActor: (actorId) => this.requireActor(actorId),
      nextId: () => this.runtime.idGenerator.next(),
      lifecycleEpoch: () => this.lifecycleEpoch,
      isActive: () => this.statusValue === "running" || this.statusValue === "paused",
      expectForegroundOperation: (input) => this.foregroundOperations.expect(input),
      startForegroundOperation: (contextId, operation) => this.foregroundOperations.start(contextId, operation),
      clearForegroundOperation: (contextId, operation) => this.foregroundOperations.clear(contextId, operation),
      failForegroundOperation: (contextId, operation, kind, message, userMessage, retryable) => (
        this.foregroundOperations.fail(contextId, operation, kind, message, userMessage, retryable)
      ),
      retryOrFailForegroundOperation: (contextId, operation, kind, message, retryDelayMs) => (
        this.foregroundOperations.retryOrFail(contextId, operation, kind, message, retryDelayMs)
      ),
      handleBlockingProviderFailure: (error, source) => this.foregroundOperations.handleBlockingProviderFailure(error, source),
      getRecovery: (contextId) => this.recovery.get(contextId),
      queuePlayerTurn: (contextId, beatId, proposal) => {
        return this.presentation.queuePlayerTurn(contextId, beatId, proposal);
      },
      playerTurn: (contextId, beatId) => this.presentation.playerTurn(contextId, beatId),
      playerProposal: (contextId, beatId) => this.presentation.playerProposal(contextId, beatId),
      setPlayerProposal: (contextId, beatId, proposal) => (
        this.presentation.setPlayerProposal(contextId, beatId, proposal)
      ),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.actorRuntimeBridge = new ActorRuntimeBridge({
      state: this.state,
      presentation: this.presentation,
      now: () => this.now(),
      isStopped: () => this.statusValue === "stopped",
      getContextRuntime: (contextId) => this.contextRuntimes.get(contextId),
      getActiveBeat: (contextId) => this.activeBeatForContext(contextId),
      getForegroundRecovery: (contextId) => this.recovery.get(contextId),
      activateContext: (contextId) => this.activateContext(contextId),
      scheduleContextSuspend: (contextId) => this.scheduleContextSuspend(contextId),
      scheduleNarrator: (contextId, mode, sourceEventIds) => (
        this.scheduleNarrator(contextId, mode, sourceEventIds)
      ),
      maybeScheduleBeatClosureCheck: (contextId, beatId, force, sourceEventIds) => (
        this.maybeScheduleBeatClosureCheck(contextId, beatId, force, sourceEventIds)
      ),
      recordAmbientNoop: (contextId) => this.contextActivity.recordAmbientNoop(contextId),
      currentFocusActors: (contextId) => this.contextActivity.currentFocusActors(contextId),
      updateContextFocus: (contextId, actorId, reason) => (
        this.contextActivity.updateFocus(contextId, actorId, reason)
      ),
      recordContextActivity: (contextId, focusActorId) => (
        this.contextActivity.recordActivity(contextId, focusActorId)
      ),
      actorWakeValidationError: (actorId, contextId, source, requireRuntimeReady) => (
        this.actorPresenceRuntime.actorWakeValidationError(
          actorId,
          contextId,
          source,
          requireRuntimeReady,
        )
      ),
      expectForegroundOperation: (input) => this.foregroundOperations.expect(input),
      startForegroundOperation: (contextId) => this.foregroundOperations.start(contextId, "actor"),
      clearForegroundOperation: (contextId) => this.foregroundOperations.clear(contextId, "actor"),
      failForegroundOperation: (contextId, kind, message, userMessage, retryable) => (
        this.foregroundOperations.fail(contextId, "actor", kind, message, userMessage, retryable)
      ),
      retryOrFailForegroundOperation: (contextId, kind, message, retryDelayMs) => (
        this.foregroundOperations.retryOrFail(contextId, "actor", kind, message, retryDelayMs)
      ),
      handleBlockingProviderFailure: (error, source) => (
        this.foregroundOperations.handleBlockingProviderFailure(error, source)
      ),
      transitionActorPresence: (input) => this.actorPresenceRuntime.transitionActorPresence(input),
      transitionActorParticipation: (input) => this.actorPresenceRuntime.transitionActorParticipation(input),
      appendEvent: (input) => this.appendEvent(input),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.actorPresenceRuntime = new ActorPresenceRuntime({
      state: this.state,
      policy: this.policy,
      now: () => this.now(),
      isStopped: () => this.statusValue === "stopped",
      getContextRuntime: (contextId) => this.contextRuntimes.get(contextId),
      getContextRuntimes: () => this.contextRuntimes.values(),
      requireActor: (actorId) => this.requireActor(actorId),
      requireContext: (contextId) => this.requireContext(contextId),
      assertContextDisplayNameAvailable: (contextId, actorId) => (
        this.actorCommands.assertContextDisplayNameAvailable(contextId, actorId)
      ),
      syncContextRoster: (contextId) => this.actorRuntimeBridge.syncContextRoster(contextId),
      pruneContextFocus: (contextId, reason) => this.contextActivity.pruneFocus(contextId, reason),
      activateContext: (contextId) => this.activateContext(contextId),
      considerDirectorWork: (immediate) => this.considerDirectorWork(immediate),
      appendEvent: (input) => this.appendEvent(input),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.eventRuntime = new WorldEventRuntime({
      state: this.state,
      isStopped: () => this.statusValue === "stopped",
      assertNotStopped: (operation) => this.assertNotStopped(operation),
      getContextRuntime: (contextId) => this.contextRuntimes.get(contextId),
      requireContext: (contextId) => this.requireContext(contextId),
      requireActor: (actorId) => this.requireActor(actorId),
      activeBeatForContext: (contextId) => this.activeBeatForContext(contextId),
      recordContextActivity: (contextId) => this.contextActivity.recordActivity(contextId),
      activateContext: (contextId) => this.activateContext(contextId),
      scheduleContextSuspend: (contextId) => this.scheduleContextSuspend(contextId),
      scheduleNarrator: (contextId, mode, sourceEventIds) => (
        this.scheduleNarrator(contextId, mode, sourceEventIds)
      ),
      scheduleDirector: (immediate, reason) => this.scheduleDirector(immediate, reason),
      considerDirectorWork: (immediate) => this.considerDirectorWork(immediate),
      appendEvent: (input) => this.appendEvent(input),
    });
    this.contextLifecycle = new ContextLifecycleRuntime({
      state: this.state,
      runtime: this.runtime,
      recovery: this.recovery,
      actorMemoryUpdates: this.actorMemoryUpdates,
      getStatus: () => this.statusValue,
      requireContext: (contextId) => this.requireContext(contextId),
      requireActor: (actorId) => this.requireActor(actorId),
      isConversationContext: (context) => isConversationContext(context),
      runContext: (context) => this.actorRuntimeBridge.runContext(context),
      scheduleSuspend: (contextId, delay) => this.contextActivity.scheduleSuspend(contextId, delay),
      scheduleAmbient: (contextId, delay) => this.contextActivity.scheduleAmbient(contextId, delay),
      appendEvent: (input) => this.appendEvent(input),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.contextRuntimeFactory = new WorldContextRuntimeFactory({
      state: this.state,
      directorEnabled: this.policy.enabled,
      characterProvider: this.characterProvider,
      compressionProvider: this.directorProvider,
      runtime: this.runtime,
      debug: this.debug,
      contextRuntimes: this.contextRuntimes,
      actorRuntimeBridge: this.actorRuntimeBridge,
      actorCoordinator: this.actorCoordinator,
      timelineRuntime: this.timelineRuntime,
      memoryRuntime: this.memoryRuntime,
      readActorState: (contextId, actorId) => (
        this.actorRuntimeBridge.sessionActorState(contextId, actorId)
      ),
      applyActorStatePatch: (contextId, actorId, patch, source) => {
        this.actorRuntimeBridge.applyContextActorStatePatch(contextId, actorId, patch, source);
      },
      commitContextActorAction: (contextId, actorId, action) => {
        this.commitContextActorAction(contextId, actorId, action);
      },
      forwardSessionDebug: (contextId, nameToActorId, event) => {
        this.diagnostics.traceSession(contextId, nameToActorId, event);
      },
      publishProviderUsage: (event) => {
        this.diagnostics.publishProviderUsage(event);
      },
    });
    this.contextRuntimeFactory.createAll(this.state.definition.contexts, options.snapshot);
    this.conversationContextCreator = new ConversationContextCreator({
      state: this.state,
      runtime: this.runtime,
      contextRuntimeFactory: this.contextRuntimeFactory,
      getStatus: () => this.statusValue,
      requireActor: (actorId) => this.requireActor(actorId),
      appendEvent: (input) => this.appendEvent(input),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
      activateContext: (contextId) => this.activateContext(contextId),
    });
    this.contextPresentation.initialize(
      this.state.definition.contexts.map((context) => context.id),
      this.presentation.snapshot(),
    );
    this.narratorViewBuilder = new NarratorViewBuilder({
      state: this.state,
      presentation: this.presentation,
      timeline: this.timelineRuntime,
      getContext: (contextId) => this.requireContext(contextId),
      playerActorId: (contextId) => this.actorCommands.playerActorIdForContext(contextId),
      actorWasSpawnedForBeat: (actorId, beat) => this.directorSupport.actorWasSpawnedForBeat(actorId, beat),
      actorWakeValidationError: (actorId, contextId) => (
        this.actorPresenceRuntime.actorWakeValidationError(actorId, contextId, "director", false)
      ),
    });
    this.narratorResultApplier = new NarratorResultApplier({
      state: this.state,
      runtime: this.runtime,
      presentation: this.presentation,
      getContextRuntime: (contextId) => this.contextRuntimes.get(contextId),
      playerActorIdForContext: (contextId) => this.actorCommands.playerActorIdForContext(contextId),
      requestActorWake: (input) => this.actorRuntimeBridge.requestActorWake(input),
      preparePlayerTurn: (contextId, beat, prompt, guidance) => (
        this.playerTurnRuntime.prepare(contextId, beat, prompt, guidance)
      ),
      scheduleDirectorTransition: (contextId, beat, request, sourceEventIds) => (
        this.scheduleDirectorTransition(contextId, beat, request, sourceEventIds)
      ),
      scheduleDirector: (immediate, reason) => this.scheduleDirector(immediate, reason),
      maybeScheduleBeatClosureCheck: (contextId, beatId, force, sourceEventIds) => (
        this.maybeScheduleBeatClosureCheck(contextId, beatId, force, sourceEventIds)
      ),
      scheduleContextSuspend: (contextId) => this.scheduleContextSuspend(contextId),
      recordAmbientNoop: (contextId) => this.contextActivity.recordAmbientNoop(contextId),
      completeBeat: (beat, outcome, sourceEventIds, reason, preservePresentation) => (
        this.completeBeat(beat, outcome, sourceEventIds, reason, preservePresentation)
      ),
      actorWasSpawnedForBeat: (actorId, beat) => this.directorSupport.actorWasSpawnedForBeat(actorId, beat),
      beatActorTurnCount: (beat) => this.beatActorTurnCount(beat),
      minimumBeatActorTurns: (beat) => minimumBeatActorTurns(beat),
      commitNarration: (input) => this.appendEvent(input),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.narratorRuntime = new NarratorRuntime({
      runtime: this.runtime,
      policy: this.policy,
      narrator,
      isRunning: () => this.statusValue === "running",
      isPaused: () => this.statusValue === "paused",
      lifecycleEpoch: () => this.lifecycleEpoch,
      activeBeatForContext: (contextId) => this.activeBeatForContext(contextId),
      canRunNarrator: (contextId) => {
        const context = this.contextRuntimes.get(contextId);
        if (!context) return false;
        if (context.definition.presentation?.kind !== "galgame") return true;
        return context.turnCoordinator.pendingNarratorWakeCount === 0 &&
          !(this.presentation.current(contextId) && !this.presentation.canPrefetch(contextId));
      },
      buildNarratorView: (contextId, beat, sourceEventIds, direction) => (
        this.buildNarratorView(contextId, beat, sourceEventIds, direction)
      ),
      applyNarratorResult: (contextId, beat, mode, result, sourceEventIds) => {
        this.applyNarratorResult(contextId, beat, mode, result, sourceEventIds);
      },
      beatActorTurnCount: (beat) => this.narratorViewBuilder.beatActorTurnCount(beat),
      minimumBeatActorTurns: (beat) => minimumBeatActorTurns(beat),
      latestContextEventIds: (contextId, limit) => this.narratorViewBuilder.latestContextEventIds(contextId, limit),
      expectForegroundOperation: (input) => this.foregroundOperations.expect(input),
      startForegroundOperation: (contextId, operation) => this.foregroundOperations.start(contextId, operation),
      clearForegroundOperation: (contextId, operation) => this.foregroundOperations.clear(contextId, operation),
      failForegroundOperation: (contextId, operation, kind, message, userMessage, retryable) => (
        this.foregroundOperations.fail(contextId, operation, kind, message, userMessage, retryable)
      ),
      retryOrFailForegroundOperation: (contextId, operation, kind, message, retryDelayMs) => (
        this.foregroundOperations.retryOrFail(contextId, operation, kind, message, retryDelayMs)
      ),
      handleBlockingProviderFailure: (error, source) => this.foregroundOperations.handleBlockingProviderFailure(error, source),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.beatCompletion = new BeatCompletionRuntime({
      state: this.state,
      narratorRuntime: this.narratorRuntime,
      actorMemoryUpdates: this.actorMemoryUpdates,
      presentation: this.presentation,
      appendEvent: (input) => this.appendEvent(input),
    });
    this.directorMutationApplier = new DirectorMutationApplier({
      state: this.state,
      presentation: this.presentation,
      getContextRuntime: (contextId) => this.contextRuntimes.get(contextId),
      applyActorBackgroundUpdate: (mutation, causationId) => (
        this.directorSupport.applyActorBackgroundUpdate(mutation, causationId)
      ),
      emitWorldEvent: (input, triggerDirector, causationId) => (
        this.emitWorldEvent(input, triggerDirector, causationId)
      ),
      validateBeatSources: (chapterId, sourceEventIds, staged) => (
        this.directorSupport.beatSourceValidationError(chapterId, sourceEventIds, staged)
      ),
      clearNarratorCheckpoint: (beatId) => this.narratorRuntime.clearCheckpoint(beatId),
      commitActorRegistration: (input, causationId) => (
        this.actorCommands.registerActor(input, causationId)
      ),
      transitionActorParticipation: (input) => this.actorPresenceRuntime.transitionActorParticipation(input),
      transitionActorPresence: (input) => this.actorPresenceRuntime.transitionActorPresence(input),
      scheduleNarrator: (contextId, mode, sourceEventIds) => (
        this.scheduleNarrator(contextId, mode, sourceEventIds)
      ),
      completeBeat: (beat, outcome, sourceEventIds, reason, preservePresentation) => (
        this.completeBeat(beat, outcome, sourceEventIds, reason, preservePresentation)
      ),
      appendEvent: (input) => this.appendEvent(input),
    });
    const directorHost = createWorldDirectorHost({
      state: this.state,
      inspection: this.inspection,
      source: this.sourceHost,
      now: () => this.now(),
      nextId: () => this.runtime.idGenerator.next(),
      canControlActor: (actorId, operation) => (
        this.actorPresenceRuntime.canControlActor(actorId, "director", operation)
      ),
      hasContext: (contextId) => this.contextRuntimes.has(contextId),
      validateActorBackgroundUpdate: (actorId, text, sourceEventIds) => (
        this.directorSupport.actorBackgroundUpdateError(actorId, text, sourceEventIds)
      ),
      validateSpawnActor: (contextId, name) => (
        this.directorSupport.spawnActorValidationError(contextId, name)
      ),
      validateSpawnedActor: (actorId, contextId) => (
        this.directorSupport.spawnedActorValidationError(actorId, contextId)
      ),
      validateBeatSources: (chapterId, sourceEventIds, staged) => (
        this.directorSupport.beatSourceValidationError(chapterId, sourceEventIds, staged)
      ),
    });
    this.directorRuntime = new DirectorRuntime({
      state: this.state,
      policy: this.policy,
      runtime: this.runtime,
      director,
      directorTaskBuilder: this.directorTaskBuilder,
      directorViewBuilder: this.directorViewBuilder,
      createDirectorHost: () => directorHost,
      traceDirector: (event) => this.diagnostics.traceDirector(event),
      isRunning: () => this.statusValue === "running",
      isPaused: () => this.statusValue === "paused",
      isStopped: () => this.statusValue === "stopped",
      lifecycleEpoch: () => this.lifecycleEpoch,
      isWorldEventOwnedByActiveBeat: (event) => this.isWorldEventOwnedByActiveBeat(event),
      isDeferredWhileBeatRuns: (event) => this.isDeferredWhileBeatRuns(event),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
      expectDirectorForeground: (contextId, transition, expectedAt) => {
        this.foregroundOperations.expect({
          contextId,
          operation: "director",
          responsibility: transition ? "transition_beat" : "open_beat",
          intent: { operation: "director" },
          ...(expectedAt == null ? {} : { expectedAt }),
        });
      },
      startDirectorForeground: (contextId) => this.foregroundOperations.start(contextId, "director"),
      clearDirectorForeground: (contextId) => this.foregroundOperations.clear(contextId, "director"),
      failDirectorForeground: (contextId, kind, message, userMessage, retryable) => {
        this.foregroundOperations.fail(
          contextId,
          "director",
          kind,
          message,
          userMessage,
          retryable,
        );
      },
      retryDirectorForeground: (contextIds, kind, message, retryDelayMs) => this.foregroundOperations.retryMany("director", contextIds, kind, message, retryDelayMs),
      handleProviderFailure: (error) => this.foregroundOperations.handleBlockingProviderFailure(
        providerFailureDetails(error),
        { operation: "director" },
      ),
      applyDirectorMutations: (mutations, batchEvents, taskMode) => (
        this.applyDirectorMutations(mutations, batchEvents, taskMode)
      ),
      recordAmbientNoop: (contextId) => this.contextActivity.recordAmbientNoop(contextId),
      shouldRecordAmbientNoop: (contextId) => (
        this.contextRuntimes.get(contextId)?.turnCoordinator.pendingAmbientWakeCount === 0 &&
        this.state.contexts.get(contextId)?.activity?.nextAmbientAt == null
      ),
    });
    this.lifecycle = new WorldLifecycleRuntime({
      state: this.state,
      runtime: this.runtime,
      contextRuntimes: this.contextRuntimes,
      directorRuntime: this.directorRuntime,
      narratorRuntime: this.narratorRuntime,
      presentation: this.presentation,
      actorMemoryUpdates: this.actorMemoryUpdates,
      timelineRuntime: this.timelineRuntime,
      recovery: this.recovery,
      getStatus: () => this.statusValue,
      setStatus: (status) => this.setStatus(status),
      bumpLifecycleEpoch: () => { this.lifecycleEpoch++; },
      abortPlayerTurns: () => {
        this.playerTurnRuntime.abortAll();
      },
      now: () => this.now(),
      isPrivateConversationContext,
      getActiveBeat: (contextId) => this.activeBeatForContext(contextId),
      activateContext: (contextId) => this.activateContext(contextId),
      ensureContextRunning: (context) => this.ensureContextRunning(context),
      scheduleContextAmbient: (contextId, delayOverrideMs) => (
        this.contextActivity.scheduleAmbient(contextId, delayOverrideMs)
      ),
      scheduleNarrator: (contextId, mode, sourceEventIds) => (
        this.scheduleNarrator(contextId, mode, sourceEventIds)
      ),
      latestContextEventIds: (contextId, limit) => this.latestContextEventIds(contextId, limit),
      considerDirectorWork: (immediate) => this.considerDirectorWork(immediate),
      scheduleDirector: (immediate, reason) => this.scheduleDirector(immediate, reason),
      appendEvent: (input) => this.appendEvent(input),
      notify: (type, payload) => this.notify(
        type as WorldNotificationType,
        payload as WorldNotificationPayloadMap[WorldNotificationType],
      ),
    });
    this.projections = new WorldProjectionRuntime({
      state: this.state,
      contextRuntimes: this.contextRuntimes,
      actorMemory: this.actorMemory,
      actorMemoryUpdates: this.actorMemoryUpdates,
      presentation: this.presentation,
      timelineCheckpoints: this.timelineRuntime.checkpoints,
      foregroundRecovery: this.recovery,
      debug: this.debug,
      director: this.directorRuntime,
      getStatus: () => this.statusValue,
      now: () => this.now(),
    });
  }

  get id(): string {
    return this.state.definition.metadata.id;
  }

  get status(): WorldStatus {
    return this.statusValue;
  }

  get worldTime(): number {
    return this.state.worldTime;
  }

  getRegisteredActors(): readonly WorldActorDefinition[] {
    return this.actorCommands.getRegisteredActors();
  }

  getForegroundRecovery(contextId: string): WorldForegroundRecoveryState | undefined {
    return this.recovery.get(contextId);
  }

  retryForegroundOperation(input: WorldRetryForegroundOperationInput): boolean {
    return this.recovery.retry(input);
  }

  dismissForegroundFailure(input: WorldDismissForegroundFailureInput): boolean {
    return this.recovery.dismiss(input);
  }

  start(): void {
    this.lifecycle.start();
  }

  pause(): void {
    this.lifecycle.pause();
  }

  resume(): void {
    this.lifecycle.resume();
  }

  stop(): void {
    this.lifecycle.stop();
  }

  registerActor(input: WorldRegisterActorInput): WorldEvent {
    return this.actorCommands.registerActor(input);
  }

  /** Open a new conversation while keeping World-level Actor state shared. */
  createChatContext(input: WorldCreateChatContextInput): WorldContextDefinition {
    return this.conversationContextCreator.create(input);
  }

  /** True when this Context is an isolated group/private dialog surface. */
  isConversationContext(contextId: string): boolean {
    return isConversationContext(this.requireContext(contextId).definition);
  }

  /** True only for a private ask-response Context. */
  isPrivateConversationContext(contextId: string): boolean {
    return isPrivateConversationContext(this.requireContext(contextId).definition);
  }

  private commitContextActorAction(
    contextId: string,
    actorId: string | undefined,
    action: ActorAction,
  ): void {
    this.actorRuntimeBridge.commitContextActorAction(contextId, actorId, action);
  }

  sendMessage(input: WorldMessageInput): void {
    this.actorCommands.sendMessage(input);
  }

  updatePlayerCard(input: WorldUpdatePlayerCardInput): void {
    this.actorCommands.updatePlayerCard(input);
  }

  submitPlayerTurn(input: WorldSubmitPlayerTurnInput): void {
    this.assertNotStopped("submit a Player turn");
    const actor = this.requireActor(input.actorId);
    if (!isPlayerControlledActor(actor)) throw new Error(`Actor ${input.actorId} is not controlled by a human.`);
    if (this.actorCommands.playerActorIdForContext(input.contextId) !== input.actorId) {
      throw new Error(`Actor ${input.actorId} is not the presentation player for ${input.contextId}.`);
    }
    if (!input.skip && !input.performance) {
      throw new Error("A player turn must include a performance or explicitly skip the turn.");
    }
    const accepted = this.presentation.submitPlayerTurn(
      input.contextId,
      input.actorId,
      input.proposalId,
      input.performance,
      input.skip === true,
    );
    if (!accepted) throw new Error("The player turn is stale or the runtime is not waiting for the player.");
  }

  acknowledgePresentation(input: WorldAcknowledgePresentationInput): PresentationAcknowledgementResult {
    this.assertNotStopped("acknowledge a presentation turn");
    const context = this.requireContext(input.contextId);
    if (context.definition.presentation?.kind !== "galgame") {
      throw new Error(`Context ${input.contextId} does not require presentation acknowledgement.`);
    }
    const result = this.presentation.acknowledgePresentation(input.contextId, input.turnToken);
    if (result === "stale") {
      throw new Error("Presentation turn token is stale.");
    }
    return result;
  }

  emitEvent(input: WorldExternalEventInput): WorldEvent {
    return this.emitWorldEvent(input, true);
  }

  changeDirection(input: WorldDirectionInput): void {
    this.assertNotStopped("change direction in a stopped world");
    const direction = input.direction.trim();
    if (!direction) throw new Error("World direction cannot be empty.");
    const context = this.requireContext(input.contextId);
    if (isConversationContext(context.definition)) {
      throw new Error("Conversation contexts do not accept World direction changes.");
    }
    this.activateContext(input.contextId);
    this.interruptContextForDirection(context);
    if (this.activeBeatForContext(input.contextId)) {
      this.scheduleNarrator(input.contextId, "redirect_scene", [], 0, direction);
    } else {
      this.narratorRuntime.defer(input.contextId, "redirect_scene", direction);
      this.requestProgression({
        contextId: input.contextId,
        reason: "observer_continue",
      });
    }
    this.contextActivity.recordActivity(input.contextId);
    this.scheduleContextSuspend(input.contextId);
  }

  requestProgression(input: WorldProgressionInput): WorldEvent {
    if (!this.policy.enabled) {
      throw new Error("World Director is disabled.");
    }
    const context = this.requireContext(input.contextId);
    if (isConversationContext(context.definition)) {
      throw new Error("Conversation contexts do not run World progression.");
    }
    if (this.statusValue === "stopped") {
      throw new Error("Cannot request progression for a stopped world.");
    }
    const reason = input.reason ?? "observer_continue";
    const event = this.appendEvent({
      type: "world.progression.requested",
      contextId: input.contextId,
      payload: { reason },
    });
    if (reason !== "ambient") {
      this.activateContext(input.contextId);
      this.contextActivity.recordActivity(input.contextId);
    }
    const activeBeat = this.activeBeatForContext(input.contextId);
    if (activeBeat) {
      // Observer progression belongs to the current scene. Do not open a
      // second Beat while the current one is still being played.
      this.maybeScheduleBeatClosureCheck(input.contextId, activeBeat.id, true, [event.id]);
    } else {
      this.scheduleDirector(true, reason);
    }
    return event;
  }

  activateContext(contextId: string): void {
    this.contextLifecycle.activate(contextId);
  }

  pauseContext(
    contextId: string,
    pauseReason: "manual" | "unread" | "unobserved" = "manual",
  ): void {
    this.contextLifecycle.pause(contextId, pauseReason);
  }

  resumeContext(contextId: string): void {
    this.contextLifecycle.resume(contextId);
  }

  suspendContext(contextId: string): void {
    this.contextLifecycle.suspend(contextId);
  }

  onEvent(listener: WorldEventListener): WorldUnsubscribe {
    return this.state.journal.subscribe(listener);
  }

  onNotification(listener: WorldNotificationListener): WorldUnsubscribe {
    return this.notifications.on(listener);
  }

  onDebug(listener: WorldDebugListener): WorldUnsubscribe {
    return this.diagnostics.onDebug(listener);
  }

  onProviderUsage(listener: ProviderUsageEventListener): WorldUnsubscribe {
    return this.diagnostics.onProviderUsage(listener);
  }

  getContextMessages(contextId: string): readonly ChatMessage[] {
    return this.requireContext(contextId).session.messages.map(cloneMessage);
  }

  getContextPacingMultiplier(contextId: string): number {
    return this.contextPresentation.getPacingMultiplier(contextId);
  }

  /** Change the reading cadence of one Context without rebuilding it. */
  setContextPacingMultiplier(contextId: string, value: number): number {
    return this.contextPresentation.setPacingMultiplier(contextId, value);
  }

  /** Change only the presentation consumer; generation pacing stays stable. */
  setContextPresentationMode(contextId: string, mode: "world" | "stage"): "world" | "stage" {
    return this.contextPresentation.setMode(contextId, mode);
  }

  setContextPresentationPolicy(
    contextId: string,
    input: { presentationPrefetchLimit?: number },
  ): ResolvedBeatRuntimeConfig {
    return this.contextPresentation.setPolicy(contextId, input);
  }

  getActorState(actorId: string) {
    return this.actorCommands.getActorState(actorId);
  }

  getActorBackground(actorId: string): WorldActorBackgroundState | undefined {
    return this.actorCommands.getActorBackground(actorId);
  }

  getActorControlPolicy(actorId: string) {
    return this.actorCommands.getActorControlPolicy(actorId);
  }

  setActorPresence(input: WorldSetActorPresenceInput): void {
    this.actorCommands.setActorPresence(input);
  }

  setActorParticipation(input: WorldSetActorParticipationInput): void {
    this.actorCommands.setActorParticipation(input);
  }

  updateActorControlPolicy(input: WorldUpdateActorControlPolicyInput): void {
    this.actorCommands.updateActorControlPolicy(input);
  }

  recallActorMemory(
    actorId: string,
    query: Omit<ActorMemoryRecallQuery, "actorId"> = {},
  ): ActorMemorySlice {
    return this.memoryCommands.recall(actorId, query);
  }

  getActorMemorySnapshot(actorId: string): ActorMemorySnapshot {
    return this.memoryCommands.snapshot(actorId);
  }

  recordActorMemory(input: WorldRecordActorMemoryInput): ActorMemoryNode {
    return this.memoryCommands.record(input);
  }

  reviseActorMemory(input: WorldReviseActorMemoryInput): ActorMemoryNode {
    return this.memoryCommands.revise(input);
  }

  snapshot(): WorldSnapshot {
    return this.projections.snapshot();
  }

  debugSnapshot(): WorldDebugSnapshot {
    return this.projections.debugSnapshot();
  }

  private emitWorldEvent(
    input: WorldExternalEventInput,
    triggerDirector: boolean,
    causationId?: string,
  ): WorldEvent {
    return this.eventRuntime.emit(input, triggerDirector, causationId);
  }

  private considerDirectorWork(immediate: boolean): void {
    this.directorRuntime.consider(immediate);
  }

  private scheduleDirectorTransition(
    contextId: string,
    beat: NarrativeBeat,
    request: NarratorDirectorRequest,
    sourceEventIds: readonly string[],
  ): void {
    this.directorRuntime.scheduleTransition(contextId, beat, request, sourceEventIds);
  }

  private isDeferredWhileBeatRuns(event: WorldEvent): boolean {
    return this.eventRuntime.isDeferredWhileBeatRuns(event);
  }

  private scheduleDirector(
    immediate: boolean,
    reason = "event_batch",
  ): void {
    this.directorRuntime.schedule(immediate, reason);
  }

  private isWorldEventOwnedByActiveBeat(event: WorldEvent): boolean {
    return this.eventRuntime.isOwnedByActiveBeat(event);
  }

  private interruptContextForDirection(context: ChatContextRuntime): void {
    const contextId = context.definition.id;
    context.ambientTask?.cancel();
    context.ambientTask = undefined;
    context.turnCoordinator.clear();

    this.narratorRuntime.interrupt(contextId);

    this.playerTurnRuntime.abort(contextId);
    this.presentation.interruptContext(contextId);
    context.session.interruptPendingActorWork("user direction is being rewritten by Narrator");
  }

  private scheduleNarrator(
    contextId: string,
    mode: NarratorMode,
    sourceEventIds: readonly string[] = [],
    delayMs = 0,
    direction?: string,
  ): void {
    this.narratorRuntime.schedule(contextId, mode, sourceEventIds, delayMs, direction);
  }

  /**
   * Beat checks happen at scene-level boundaries, not after every visible line.
   * A Narrator-requested Actor burst forms one boundary; ordinary Actor output
   * stays inside the current scene until the next burst, player intervention,
   * or ambient checkpoint.
   */
  private maybeScheduleBeatClosureCheck(
    contextId: string,
    beatId: string,
    force = false,
    sourceEventIds: readonly string[] = [],
  ): void {
    this.narratorRuntime.maybeScheduleBeatClosureCheck(
      contextId,
      beatId,
      force,
      sourceEventIds,
    );
  }

  private buildNarratorView(
    contextId: string,
    beat: NarrativeBeat,
    sourceEventIds: readonly string[],
    direction?: string,
  ) {
    return this.narratorViewBuilder.build(contextId, beat, sourceEventIds, direction);
  }

  private beatActorTurnCount(beat: NarrativeBeat): number {
    return this.narratorViewBuilder.beatActorTurnCount(beat);
  }

  private latestContextEventIds(contextId: string, limit: number): string[] {
    return this.narratorViewBuilder.latestContextEventIds(contextId, limit);
  }

  private applyNarratorResult(
    contextId: string,
    beat: NarrativeBeat,
    mode: NarratorMode,
    result: NarratorResult,
    sourceEventIds: readonly string[],
  ): void {
    this.narratorResultApplier.apply(
      contextId,
      beat,
      mode,
      result,
      sourceEventIds,
    );
  }

  private activeBeatForContext(contextId: string): NarrativeBeat | undefined {
    return [...this.state.beats.values()]
      .filter((beat) => beat.status === "running" && beat.contextIds.includes(contextId))
      .sort((left, right) => right.occurredAt - left.occurredAt)[0];
  }

  private completeBeat(
    beat: NarrativeBeat,
    outcome: string,
    sourceEventIds: readonly string[],
    reason: "resolved" | "superseded",
    preservePresentation = false,
  ): void {
    this.beatCompletion.complete(
      beat,
      outcome,
      sourceEventIds,
      reason,
      preservePresentation,
    );
  }

  private applyDirectorMutations(
    mutations: readonly WorldDirectorMutation[],
    sourceEvents: readonly WorldEvent[],
    taskMode?: WorldDirectorTaskMode,
  ): Set<string> {
    return this.directorMutationApplier.apply(mutations, sourceEvents, taskMode);
  }

  private scheduleContextSuspend(contextId: string, delay = this.policy.contextSuspendAfterMs): void {
    this.contextActivity.scheduleSuspend(contextId, delay);
  }

  private ensureContextRunning(context: ChatContextRuntime): void {
    this.contextLifecycle.ensureRunning(context);
  }

  private appendEvent<TType extends import("../../contracts/world.js").WorldEventType>(
    input: WorldEventInput<TType>,
  ): WorldEvent<TType> {
    return this.eventRecorder.append(input);
  }

  private requireContext(contextId: string): ChatContextRuntime {
    const context = this.contextRuntimes.get(contextId);
    if (!context) throw new Error(`Unknown world context: ${contextId}`);
    return context;
  }

  private assertNotStopped(operation: string): void {
    if (this.statusValue === "stopped") {
      throw new Error(`Cannot ${operation} after the World has stopped.`);
    }
  }

  private assertMessageInputAllowed(context: ChatContextRuntime): void {
    this.assertNotStopped("send a message");
    if (isConversationContext(context.definition)) {
      if (this.state.contexts.get(context.definition.id)?.status === "paused") {
        throw new Error("Cannot send a message while the conversation is paused.");
      }
      return;
    }
    if (
      this.statusValue !== "running" &&
      !isPrivateConversationContext(context.definition)
    ) {
      throw new Error("Cannot send a message while the World is not running.");
    }
  }

  private assertMemorySourcesExist(sourceEventIds: readonly string[] | undefined): void {
    if (!sourceEventIds?.length) return;
    const knownIds = new Set(this.state.journal.all().map((event) => event.id));
    for (const eventId of sourceEventIds) {
      if (!knownIds.has(eventId)) {
        throw new Error(`Actor memory source event does not exist: ${eventId}`);
      }
    }
  }

  private requireActor(actorId: string): WorldActorDefinition {
    const actor = this.state.getActorDefinition(actorId);
    if (!actor) throw new Error(`Unknown world actor: ${actorId}`);
    return actor;
  }

  private setStatus(status: WorldStatus): void {
    if (this.statusValue === status) return;
    const previous = this.statusValue;
    this.statusValue = status;
    this.notify("world.status_changed", { previous, status });
  }

  private notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void {
    this.notifications.notify(type, payload);
  }

  private now(): number {
    return this.runtime.clock.now();
  }
}
