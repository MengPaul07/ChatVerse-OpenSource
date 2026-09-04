import { randomUUID } from "node:crypto";
import {
  worldDefinitionFromGroup,
  type GroupCard,
  type WorldArchive,
  type WorldDefinition,
  type WorldSourceProvider,
} from "@chatverse/core";
import type { ProviderRequestConfig } from "../provider-config.js";
import {
  WorldRoom,
  type RoomRegistryOptions,
  type WorldRoomRestoreOptions,
} from "./room.js";
export type {
  ProviderPair,
  RoomRegistryOptions,
  WorldDebugLogEntry,
  WorldRoomRestoreOptions,
} from "./room.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_ROOMS = 50;
const DEFAULT_STREAM_CACHE_SIZE = 500;
const DEFAULT_DEBUG_CACHE_SIZE = 2_000;

export class WorldRoomRegistry {
  private readonly rooms = new Map<string, WorldRoom>();
  private readonly ttlMs: number;
  private readonly maxRooms: number;
  private readonly streamCacheSize: number;
  private readonly debugCacheSize: number;
  private readonly now: () => number;

  constructor(private readonly options: RoomRegistryOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.streamCacheSize = options.streamCacheSize ?? DEFAULT_STREAM_CACHE_SIZE;
    this.debugCacheSize = options.debugCacheSize ?? DEFAULT_DEBUG_CACHE_SIZE;
    this.now = options.now ?? Date.now;
  }

  async createGroupRoom(group: GroupCard, providerConfig?: ProviderRequestConfig): Promise<WorldRoom> {
    return this.createRoom(
      worldDefinitionFromGroup(group),
      randomUUID(),
      undefined,
      {},
      providerConfig,
    );
  }

  async createDefinitionRoom(
    definition: WorldDefinition,
    bootstrap = true,
    providerConfig?: ProviderRequestConfig,
    sourceProvider?: WorldSourceProvider,
  ): Promise<WorldRoom> {
    return this.createRoom(
      definition,
      randomUUID(),
      bootstrap && definition.directorPolicy?.enabled !== false
        ? definition.contexts[0]?.id
        : undefined,
      {},
      providerConfig,
      sourceProvider,
    );
  }

  async createArchiveRoom(
    archive: WorldArchive,
    providerConfig?: ProviderRequestConfig,
    sourceProvider?: WorldSourceProvider,
  ): Promise<WorldRoom> {
    const definition = structuredClone(archive.definition);
    return this.createRoom(
      definition,
      randomUUID(),
      definition.directorPolicy?.enabled === false
        ? undefined
        : firstProgressionContextId(definition),
      {
        snapshot: structuredClone(archive.snapshot),
        archiveId: archive.archiveId,
        archiveCreatedAt: archive.metadata.createdAt,
      },
      providerConfig,
      sourceProvider,
    );
  }

  private async createRoom(
    definition: WorldDefinition,
    roomId: string,
    bootstrapContextId?: string,
    restore: WorldRoomRestoreOptions = {},
    providerConfig?: ProviderRequestConfig,
    sourceProvider?: WorldSourceProvider,
  ): Promise<WorldRoom> {
    this.cleanup();
    this.ensureCapacity();
    const room = new WorldRoom(
      roomId,
      definition,
      await this.options.providerFactory(providerConfig),
      this.streamCacheSize,
      this.debugCacheSize,
      this.options.debug,
      this.options.debugEventSink,
      this.now,
      bootstrapContextId,
      restore,
      sourceProvider,
      this.options.providerFactory,
      providerConfig,
    );
    this.rooms.set(roomId, room);
    return room;
  }

  get(roomId: string): WorldRoom | undefined {
    const room = this.rooms.get(roomId);
    room?.touch();
    return room;
  }

  cleanup(): number {
    const expiredBefore = this.now() - this.ttlMs;
    let removed = 0;
    for (const [roomId, room] of this.rooms) {
      if (room.clientCount > 0 || room.lastAccessAt > expiredBefore) continue;
      room.stop();
      this.rooms.delete(roomId);
      removed++;
    }
    return removed;
  }

  stopAll(): void {
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
  }

  private ensureCapacity(): void {
    if (this.rooms.size < this.maxRooms) return;
    const candidate = [...this.rooms.values()]
      .filter((room) => room.clientCount === 0)
      .sort((left, right) => left.lastAccessAt - right.lastAccessAt)[0];
    if (!candidate) throw new RoomCapacityError();
    candidate.stop();
    this.rooms.delete(candidate.id);
  }
}

export class RoomCapacityError extends Error {
  constructor() {
    super("World room capacity reached.");
    this.name = "RoomCapacityError";
  }
}

function firstProgressionContextId(definition: WorldDefinition): string | undefined {
  return definition.contexts.find((context) => (
    context.conversationMode !== "group" && context.conversationMode !== "private"
  ))?.id;
}
