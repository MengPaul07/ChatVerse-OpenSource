import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { ProviderFactory, ProviderRequestConfig } from "../provider-config.js";
import type { ProviderPair } from "./contracts.js";
import { ProviderRuntime } from "../provider-runtime.js";
export type { ProviderPair } from "./contracts.js";
import {
  ChatVerse,
  type ProviderUsageEvent,
  type World,
  type WorldArchive,
  type WorldDebugConfig,
  type WorldDebugEvent,
  type WorldDefinition,
  type WorldEvent,
  type WorldNotification,
  type WorldSourceProvider,
  type WorldSnapshot,
} from "@chatverse/core";
import {
  projectWorldView,
  updateDirectorProjection,
  type DirectorProjection,
} from "../projection.js";
import type {
  WorldDebugStreamPayload,
  WorldDebugView,
  WorldRoomRuntimeState,
  WorldStreamPayload,
  WorldView,
  TokenUsageRecord,
} from "../types.js";
import { PresentationStreamGate } from "./presentation-stream-gate.js";

const SSE_HEARTBEAT_MS = 15_000;
const DEFAULT_AUTO_PAUSE_AFTER_MS = 5 * 60 * 1000;

export interface RoomRegistryOptions {
  providerFactory: ProviderFactory;
  ttlMs?: number;
  maxRooms?: number;
  streamCacheSize?: number;
  debugCacheSize?: number;
  debug?: boolean | WorldDebugConfig;
  debugEventSink?: (entry: WorldDebugLogEntry) => void;
  now?: () => number;
}

export interface WorldDebugLogEntry {
  recordedAt: number;
  roomId: string;
  worldId: string;
  worldName: string;
  event: WorldDebugEvent;
}

interface SseClient {
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
  activeContextId?: string;
}

interface ContextAttentionState {
  unreadCount: number;
}

export interface WorldRoomRestoreOptions {
  snapshot?: WorldSnapshot;
  archiveId?: string;
  archiveCreatedAt?: number;
}

export class WorldRoom {
  readonly id: string;
  readonly archiveId: string;
  readonly definition: WorldDefinition;
  readonly world: World;
  private readonly clients = new Set<SseClient>();
  private readonly debugClients = new Set<SseClient>();
  private readonly streamCache: WorldStreamPayload[] = [];
  private readonly debugCache: WorldDebugStreamPayload[] = [];
  private readonly presentationStream = new PresentationStreamGate();
  private readonly contextAttention = new Map<string, ContextAttentionState>();
  private readonly unsubscribers: Array<() => void> = [];
  private streamSequence = 0;
  private director: DirectorProjection = { status: "idle" };
  private providerIssue?: import("../types.js").WorldProviderIssue;
  private lastAccessAtValue: number;
  private readonly archiveCreatedAt: number;
  private bootstrapRequested = false;
  private autoPauseAfterMs: number | undefined = DEFAULT_AUTO_PAUSE_AFTER_MS;
  private autoPauseTask?: NodeJS.Timeout;
  private autoPauseDueAt?: number;
  private autoPausedAt?: number;
  private readonly providerRuntime: ProviderRuntime;

  constructor(
    roomId: string,
    definition: WorldDefinition,
    providers: ProviderPair,
    private readonly streamCacheSize: number,
    private readonly debugCacheSize: number,
    private readonly debugConfig: boolean | WorldDebugConfig | undefined,
    private readonly debugEventSink: ((entry: WorldDebugLogEntry) => void) | undefined,
    private readonly now: () => number,
    private readonly bootstrapContextId?: string,
    restore: WorldRoomRestoreOptions = {},
    sourceProvider?: WorldSourceProvider,
    providerFactory?: ProviderFactory,
    providerConfig?: ProviderRequestConfig,
  ) {
    this.id = roomId;
    this.archiveId = restore.archiveId ?? randomUUID();
    this.archiveCreatedAt = restore.archiveCreatedAt ?? now();
    const restoredContexts = [
      ...definition.contexts,
      ...(restore.snapshot?.dynamicContexts ?? []).filter((context) => (
        !definition.contexts.some((candidate) => candidate.id === context.id)
      )).map((context) => structuredClone(context)),
    ];
    this.definition = {
      ...definition,
      contexts: restoredContexts,
    };
    this.lastAccessAtValue = now();
    this.providerRuntime = new ProviderRuntime(
      providers,
      providerFactory ?? (() => providers),
      providerConfig,
    );
    this.world = new ChatVerse(this.providerRuntime.providers).createWorld(this.definition, {
      debug: debugConfig,
      snapshot: restore.snapshot,
      sourceProvider,
    });
    this.bootstrapRequested = hasNarrativeFoundation(restore.snapshot);
    this.unsubscribers.push(
      this.world.onEvent((event) => {
        if (this.presentationStream.capture(event, this.isPresentationContext(event.contextId))) return;
        this.handleUnreadEvent(event);
        this.publishEvent(event);
      }),
      this.world.onNotification((notification) => this.publishNotification(notification)),
      this.world.onProviderUsage((event) => this.publishProviderUsage(event)),
    );
    if (this.debugEnabled) {
      this.unsubscribers.push(
        this.world.onDebug((event) => this.publishDebugEvent(event)),
      );
    }
  }

  updateProviderConfig(config?: ProviderRequestConfig): Promise<void> {
    return this.providerRuntime.update(config);
  }

  get clientCount(): number {
    return this.clients.size + this.debugClients.size;
  }

  get viewerCount(): number {
    return this.clients.size;
  }

  get debugEnabled(): boolean {
    return this.debugConfig === true ||
      (typeof this.debugConfig === "object" && (this.debugConfig.enabled ?? false));
  }

  get lastAccessAt(): number {
    return this.lastAccessAtValue;
  }

  get lastStreamSequence(): number {
    return this.streamSequence;
  }

  get directorEnabled(): boolean {
    return this.definition.directorPolicy?.enabled !== false;
  }

  isConversationContext(contextId: string): boolean {
    return this.world.isConversationContext(contextId);
  }

  isPrivateContext(contextId: string): boolean {
    return this.world.isPrivateConversationContext(contextId);
  }

  get actorMemoryEnabled(): boolean {
    return this.definition.actorMemoryPolicy?.enabled === true;
  }

  updatePlayerCard(actorId: string, card: import("@chatverse/core").PlayerCharacterCard): void {
    this.world.updatePlayerCard({ actorId, card });
    const actor = this.definition.actors.find((candidate) => candidate.id === actorId);
    if (actor?.playerControlled === true) {
      actor.playerCard = structuredClone(card);
      actor.playerControlled = true;
      actor.card = {
        ...actor.card,
        name: card.name,
        description: `${card.identity}。${card.background}`,
        personality: card.personality,
        scenario: card.background,
        instructions: `表达方式：${card.speechStyle}\n行为边界：${card.boundaries}`,
        visual: card.visual ? { ...card.visual } : actor.card.visual,
      };
    }
    this.touch();
  }

  start(): boolean {
    if (this.world.status !== "idle") {
      if (this.world.status === "running") this.requestBootstrapIfNeeded();
      return this.world.status === "running";
    }
    this.world.start();
    this.requestBootstrapIfNeeded();
    this.scheduleAutoPauseIfUnobserved();
    return true;
  }

  pause(automatic = false): void {
    this.cancelAutoPause();
    this.world.pause();
    if (automatic) {
      for (const context of this.world.snapshot().contexts) {
        if (
          this.isConversationContext(context.contextId) &&
          context.status !== "paused" &&
          context.status !== "stopped"
        ) {
          this.world.pauseContext(context.contextId, "unobserved");
        }
      }
    }
    this.autoPausedAt = automatic ? this.now() : undefined;
  }

  resume(): void {
    this.autoPausedAt = undefined;
    this.world.resume();
    this.requestBootstrapIfNeeded();
    this.scheduleAutoPauseIfUnobserved();
  }

  pauseContext(contextId: string): void {
    this.touch();
    this.world.pauseContext(contextId, "manual");
    this.publishContextRuntime(contextId);
  }

  resumeContext(contextId: string): void {
    this.touch();
    this.world.resumeContext(contextId);
    this.publishContextRuntime(contextId);
  }

  configureRuntime(input: { autoPauseAfterMs?: number }): void {
    this.autoPauseAfterMs = input.autoPauseAfterMs;
    this.cancelAutoPause();
    this.scheduleAutoPauseIfUnobserved();
  }

  setPacingMultiplier(contextId: string, value: number): number {
    this.touch();
    const next = this.world.setContextPacingMultiplier(contextId, value);
    const context = this.definition.contexts.find((candidate) => candidate.id === contextId);
    if (context) {
      context.runtime = {
        ...context.runtime,
        pacingMultiplier: next,
      };
    }
    return next;
  }

  setPresentationMode(contextId: string, mode: "world" | "stage"): "world" | "stage" {
    this.touch();
    return this.world.setContextPresentationMode(contextId, mode);
  }

  setPresentationPolicy(
    contextId: string,
    input: { presentationPrefetchLimit?: number },
  ): void {
    this.touch();
    this.world.setContextPresentationPolicy(contextId, input);
    const context = this.definition.contexts.find((candidate) => candidate.id === contextId);
    if (!context) return;
    context.runtime = {
      ...context.runtime,
      beatRuntime: {
        ...context.runtime?.beatRuntime,
        ...(input.presentationPrefetchLimit != null
          ? { presentationPrefetchLimit: Math.max(0, Math.min(10, Math.round(input.presentationPrefetchLimit))) }
          : {}),
      },
    };
  }

  runtimeState(): WorldRoomRuntimeState {
    return {
      viewerCount: this.clients.size,
      autoPauseEnabled: this.autoPauseAfterMs !== undefined,
      autoPauseAfterMs: this.autoPauseAfterMs,
      autoPauseDueAt: this.autoPauseDueAt,
      autoPausedAt: this.autoPausedAt,
    };
  }

  touch(): void {
    this.lastAccessAtValue = this.now();
  }

  view(): WorldView {
    this.touch();
    return projectWorldView({
      roomId: this.id,
      world: this.world,
      definition: this.definition,
      archiveId: this.archiveId,
      director: this.director,
      lastStreamSequence: this.streamSequence,
      roomRuntime: this.runtimeState(),
      providerIssue: this.providerIssue,
      contextAttention: this.contextAttention,
    });
  }

  createChatContext(input: {
    actorIds: string[];
    conversationMode: "group" | "private";
    humanActorId?: string;
    name?: string;
    topic?: string;
  }): string {
    this.touch();
    const human = input.humanActorId?.trim() || this.definition.actors.find((actor) => (
      actor.playerControlled === true
    ))?.id;
    if (!human) throw new Error("当前世界没有可用的玩家 Actor。");
    const context = this.world.createChatContext({
      humanActorId: human,
      actorIds: input.actorIds,
      conversationMode: input.conversationMode,
      name: input.name,
      topic: input.topic,
    });
    if (!this.definition.contexts.some((item) => item.id === context.id)) {
      // World normalizes its own definition. Keep the server's public/archive
      // source in sync so the new Context survives projection and export.
      this.definition.contexts.push(structuredClone(context));
    }
    return context.id;
  }

  debugView(eventLimit?: number): WorldDebugView {
    this.touch();
    const snapshot = this.world.debugSnapshot();
    if (eventLimit != null && snapshot.events.length > eventLimit) {
      snapshot.events = snapshot.events.slice(-eventLimit);
      snapshot.firstRetainedDebugSequence = snapshot.events[0]?.sequence;
    }
    const view = projectWorldView({
      roomId: this.id,
      world: this.world,
      definition: this.definition,
      archiveId: this.archiveId,
      director: this.director,
      lastStreamSequence: this.streamSequence,
      roomRuntime: this.runtimeState(),
      providerIssue: this.providerIssue,
      contextAttention: this.contextAttention,
    });
    return {
      roomId: this.id,
      snapshot,
      actors: view.actors,
      transport: {
        debugClientCount: this.debugClients.size,
        lastDebugSequence: snapshot.lastDebugSequence,
      },
    };
  }

  archive(): WorldArchive {
    this.touch();
    const snapshot = this.world.snapshot();
    const dynamicActors = snapshot.dynamicActors;
    const actorNames = [
      ...this.definition.actors,
      ...dynamicActors,
    ].map((actor) => actor.card.name);
    const activeChapterTitles = snapshot.narrative.chapters
      .filter((chapter) => chapter.status === "active" || chapter.status === "queued")
      .map((chapter) => chapter.title);
    const lastContext = [...snapshot.contexts]
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const contextName = new Map(
      this.definition.contexts.map((context) => [context.id, context.name]),
    );
    return {
      schemaVersion: 1,
      archiveId: this.archiveId,
      worldId: this.definition.metadata.id,
      definition: structuredClone({
        ...this.definition,
        contexts: [
          ...this.definition.contexts,
          ...(snapshot.dynamicContexts ?? []).filter((context) => (
            !this.definition.contexts.some((candidate) => candidate.id === context.id)
          )),
        ],
      }),
      snapshot,
      metadata: {
        name: this.definition.metadata.name,
        description: this.definition.metadata.description,
        createdAt: this.archiveCreatedAt,
        updatedAt: this.now(),
        eventSequence: snapshot.eventSequence,
        worldTime: snapshot.worldTime,
        lastStatus: this.world.status,
        actorNames,
        activeChapterTitles,
        lastScene: lastContext
          ? {
              contextId: lastContext.contextId,
              contextName: contextName.get(lastContext.contextId) ?? lastContext.contextId,
              text: lastContext.scene.text,
            }
          : undefined,
      },
    };
  }

  attachStream(
    response: ServerResponse,
    afterSequence: number,
    activeContextId?: string,
  ): void {
    this.touch();
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 2000\n\n");

    const firstCachedSequence = this.streamCache[0]?.sequence;
    if (
      afterSequence > 0 &&
      firstCachedSequence != null &&
      afterSequence < firstCachedSequence - 1
    ) {
      writeSse(response, {
        sequence: this.streamSequence,
        kind: "resync_required",
      });
    } else {
      for (const payload of this.streamCache) {
        if (payload.sequence > afterSequence) writeSse(response, payload);
      }
    }

    const heartbeat = setInterval(() => {
      try {
        response.write(`: heartbeat ${this.now()}\n\n`);
      } catch {
        this.removeClient(client);
      }
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref();
    const client: SseClient = { response, heartbeat, activeContextId };
    this.clients.add(client);
    this.cancelAutoPause();
    if (activeContextId && this.isConversationContext(activeContextId)) {
      const attention = this.contextAttention.get(activeContextId);
      if (attention?.unreadCount) {
        attention.unreadCount = 0;
        this.publishContextRuntime(activeContextId);
      }
    }

    response.on("close", () => this.removeClient(client));
    response.on("error", () => this.removeClient(client));
  }

  attachDebugStream(response: ServerResponse, afterSequence: number): void {
    this.touch();
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 2000\n\n");
    const firstCachedSequence = this.debugCache[0]?.sequence;
    if (
      afterSequence > 0 &&
      firstCachedSequence != null &&
      afterSequence < firstCachedSequence - 1
    ) {
      response.write("event: debug_resync_required\n");
      response.write(`data: ${JSON.stringify({ sequence: this.world.debugSnapshot().lastDebugSequence })}\n\n`);
    } else {
      for (const payload of this.debugCache) {
        if (payload.sequence > afterSequence) writeSse(response, payload);
      }
    }
    const heartbeat = setInterval(() => {
      try {
        response.write(`: debug-heartbeat ${this.now()}\n\n`);
      } catch {
        this.removeDebugClient(client);
      }
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref();
    const client: SseClient = { response, heartbeat };
    this.debugClients.add(client);
    response.on("close", () => this.removeDebugClient(client));
    response.on("error", () => this.removeDebugClient(client));
  }

  stop(): void {
    this.cancelAutoPause();
    this.presentationStream.clear();
    this.world.stop();
    for (const client of [...this.clients]) {
      client.response.end();
      this.removeClient(client);
    }
    for (const client of [...this.debugClients]) {
      client.response.end();
      this.removeDebugClient(client);
    }
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }

  private publishEvent(event: WorldEvent): void {
    this.publish({
      sequence: ++this.streamSequence,
      kind: "world_event",
      event,
    });
  }

  private handleUnreadEvent(event: WorldEvent): void {
    const contextId = event.contextId;
    if (
      !contextId ||
      !this.isConversationContext(contextId) ||
      (event.type !== "context.message.committed" && event.type !== "context.action.committed")
    ) return;
    if (
      event.type === "context.message.committed" &&
      event.payload.message.source !== "character"
    ) return;
    if ([...this.clients].some((client) => client.activeContextId === contextId)) return;

    const attention = this.contextAttention.get(contextId) ?? { unreadCount: 0 };
    attention.unreadCount += 1;
    this.contextAttention.set(contextId, attention);
    const context = this.world.snapshot().contexts.find((candidate) => candidate.contextId === contextId);
    if (context?.status !== "paused" && context?.status !== "stopped") {
      // The event listener runs synchronously during Session commit. Pausing
      // here makes the harness wait before it can begin another provider call.
      this.world.pauseContext(contextId, "unread");
    }
    this.publishContextRuntime(contextId);
  }

  private publishContextRuntime(contextId: string): void {
    const context = this.world.snapshot().contexts.find((candidate) => candidate.contextId === contextId);
    if (!context) return;
    this.publish({
      sequence: ++this.streamSequence,
      kind: "context_runtime",
      contextId,
      unreadCount: this.contextAttention.get(contextId)?.unreadCount ?? 0,
      status: context.status,
      pauseReason: context.pauseReason,
    });
  }

  private publishNotification(notification: WorldNotification): void {
    this.director = updateDirectorProjection(this.director, notification);
    if (notification.type === "provider.blocked") {
      this.providerIssue = {
        ...notification.payload,
        occurredAt: notification.occurredAt,
      };
    }
    this.publish({
      sequence: ++this.streamSequence,
      kind: "world_notification",
      notification,
    });
    if (
      (notification.type === "presentation.waiting_ack" || notification.type === "presentation.waiting_player") &&
      notification.payload.buffered !== true
    ) {
      this.releasePresentationEvents(notification.payload.turn.entryIds);
    }
  }

  private isPresentationContext(contextId: string | undefined): boolean {
    if (!contextId) return false;
    return this.definition.contexts.some((context) => (
      context.id === contextId && context.presentation?.kind === "galgame"
    ));
  }

  private releasePresentationEvents(entryIds: readonly string[]): void {
    for (const event of this.presentationStream.release(entryIds)) {
      this.handleUnreadEvent(event);
      this.publishEvent(event);
    }
  }

  private publishProviderUsage(event: ProviderUsageEvent): void {
    const usage = event.usage;
    const record: TokenUsageRecord = {
      schemaVersion: 1,
      id: `${this.id}:${randomUUID()}`,
      occurredAt: this.now(),
      providerRole: event.providerRole,
      operation: event.operation,
      purpose: event.requestContext?.purpose,
      provider: usage.provider,
      model: usage.model,
      protocol: usage.protocol,
      worldId: this.definition.metadata.id,
      worldName: this.definition.metadata.name,
      roomId: this.id,
      contextId: event.requestContext?.contextId,
      actorId: event.requestContext?.actorId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens: usage.reasoningTokens,
      cacheHitInputTokens: usage.cacheHitInputTokens,
      cacheMissInputTokens: usage.cacheMissInputTokens,
      cacheMetricsReported: usage.cacheHitInputTokens !== undefined || usage.cacheMissInputTokens !== undefined,
    };
    this.publish({
      sequence: ++this.streamSequence,
      kind: "usage_recorded",
      record,
    });
  }

  private publishDebugEvent(event: WorldDebugEvent): void {
    const payload: WorldDebugStreamPayload = {
      sequence: event.sequence,
      kind: "debug_event",
      event,
    };
    this.debugCache.push(payload);
    if (this.debugCache.length > this.debugCacheSize) {
      this.debugCache.splice(0, this.debugCache.length - this.debugCacheSize);
    }
    try {
      this.debugEventSink?.({
        recordedAt: this.now(),
        roomId: this.id,
        worldId: this.definition.metadata.id,
        worldName: this.definition.metadata.name,
        event,
      });
    } catch (error) {
      console.error("Failed to persist a World debug event.", error);
    }
    for (const client of [...this.debugClients]) {
      try {
        writeSse(client.response, payload);
      } catch {
        this.removeDebugClient(client);
      }
    }
  }

  private publish(payload: WorldStreamPayload): void {
    this.streamCache.push(payload);
    if (this.streamCache.length > this.streamCacheSize) {
      this.streamCache.splice(0, this.streamCache.length - this.streamCacheSize);
    }
    for (const client of [...this.clients]) {
      try {
        writeSse(client.response, payload);
      } catch {
        this.removeClient(client);
      }
    }
  }

  private removeClient(client: SseClient): void {
    if (!this.clients.delete(client)) return;
    clearInterval(client.heartbeat);
    this.scheduleAutoPauseIfUnobserved();
  }

  private removeDebugClient(client: SseClient): void {
    if (!this.debugClients.delete(client)) return;
    clearInterval(client.heartbeat);
  }

  private scheduleAutoPauseIfUnobserved(): void {
    if (
      this.clients.size > 0 ||
      this.autoPauseAfterMs === undefined ||
      this.world.status !== "running" ||
      this.autoPauseTask
    ) return;
    this.autoPauseDueAt = this.now() + this.autoPauseAfterMs;
    this.autoPauseTask = setTimeout(() => {
      this.autoPauseTask = undefined;
      this.autoPauseDueAt = undefined;
      if (this.clients.size === 0 && this.world.status === "running") {
        this.pause(true);
      }
    }, this.autoPauseAfterMs);
    this.autoPauseTask.unref();
  }

  private cancelAutoPause(): void {
    if (this.autoPauseTask) clearTimeout(this.autoPauseTask);
    this.autoPauseTask = undefined;
    this.autoPauseDueAt = undefined;
  }

  private requestBootstrapIfNeeded(): void {
    if (
      this.bootstrapRequested ||
      !this.bootstrapContextId ||
      !this.directorEnabled
    ) return;
    this.bootstrapRequested = true;
    this.world.requestProgression({
      contextId: this.bootstrapContextId,
      reason: "bootstrap",
    });
  }
}



function hasNarrativeFoundation(snapshot: WorldSnapshot | undefined): boolean {
  return Boolean(
    snapshot?.narrative.chapters.length &&
    snapshot.narrative.beats.length,
  );
}



function writeSse(
  response: ServerResponse,
  payload: WorldStreamPayload | WorldDebugStreamPayload,
): void {
  response.write(`id: ${payload.sequence}\n`);
  response.write(`event: ${payload.kind}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
