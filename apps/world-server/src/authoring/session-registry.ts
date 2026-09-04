import { randomUUID } from "node:crypto";
import {
  createEmptyWorldDraft,
  validateWorldDraft,
  type WorldDraft,
} from "@chatverse/world-authoring";
import type { ProviderFactory, ProviderRequestConfig } from "../provider-config.js";
import {
  AuthoringCapacityError,
  AuthoringSession,
  AuthoringValidationError,
} from "./session.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_STREAM_CACHE_SIZE = 100;

export interface AuthoringRegistryOptions {
  providerFactory: ProviderFactory;
  ttlMs?: number;
  maxSessions?: number;
  streamCacheSize?: number;
  now?: () => number;
}

export class AuthoringSessionRegistry {
  private readonly sessions = new Map<string, AuthoringSession>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly streamCacheSize: number;
  private readonly now: () => number;

  constructor(private readonly options: AuthoringRegistryOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.streamCacheSize = options.streamCacheSize ?? DEFAULT_STREAM_CACHE_SIZE;
    this.now = options.now ?? Date.now;
  }

  async create(input: {
    draft?: WorldDraft;
    seed?: string;
    runtimeProfile?: "world_story" | "group_chat";
    providerConfig?: ProviderRequestConfig;
  }): Promise<AuthoringSession> {
    this.cleanup();
    this.ensureCapacity();
    const id = randomUUID();
    const draft = input.draft
      ? structuredClone(input.draft)
      : createEmptyWorldDraft({
          id: `world:${id}`,
          name: input.seed?.trim().slice(0, 40) || undefined,
          runtimeProfile: input.runtimeProfile,
        });
    const validation = validateWorldDraft(draft);
    if (
      input.draft &&
      validation.issues.some((issue) => issue.code === "context_count")
    ) {
      throw new AuthoringValidationError(validation);
    }
    const session = new AuthoringSession(
      id,
      draft,
      await this.options.providerFactory(input.providerConfig),
      this.streamCacheSize,
      this.now,
      this.options.providerFactory,
      input.providerConfig,
    );
    this.sessions.set(id, session);
    if (input.seed?.trim()) await session.message(input.seed.trim());
    return session;
  }

  get(id: string): AuthoringSession | undefined {
    const session = this.sessions.get(id);
    session?.touch();
    return session;
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.close();
    this.sessions.delete(id);
    return true;
  }

  cleanup(): number {
    const expiredBefore = this.now() - this.ttlMs;
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.clientCount > 0 || session.lastAccessAt > expiredBefore) continue;
      session.close();
      this.sessions.delete(id);
      removed++;
    }
    return removed;
  }

  stopAll(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  private ensureCapacity(): void {
    if (this.sessions.size < this.maxSessions) return;
    const candidate = [...this.sessions.values()]
      .filter((session) => session.clientCount === 0)
      .sort((left, right) => left.lastAccessAt - right.lastAccessAt)[0];
    if (!candidate) throw new AuthoringCapacityError();
    this.delete(candidate.id);
  }
}
