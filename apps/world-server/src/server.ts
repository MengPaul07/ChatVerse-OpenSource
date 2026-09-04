import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import {
  type ActorPresence,
  type ChatProvider,
  type ContextParticipation,
  type WorldDebugConfig,
  type WorldDirectorActorAuthority,
} from "@chatverse/core";
import { AuthoringSessionRegistry } from "./authoring/session-registry.js";
import {
  WorldRoomRegistry,
  type ProviderPair,
  type RoomRegistryOptions,
} from "./rooms/registry.js";
import type { WorldRoom } from "./rooms/room.js";
import {
  hasProviderCredential,
  type ProviderRequestConfig,
} from "./provider-config.js";
import { HttpError } from "./http/errors.js";
import { setCommonHeaders } from "./http/headers.js";
import { handleError, sendJson } from "./http/response.js";
import { serveStatic } from "./http/static.js";
import { parseSequence } from "./http/query.js";
import {
  createDebugLogWriterFromEnvironment,
  createEnvironmentProviders,
  debugConfigFromEnvironment,
  hasEnvironmentProviderCredential,
  PROVIDER_NOT_CONFIGURED_MESSAGE,
} from "./environment.js";
import {
  draftRevision,
  sourceMaterials,
  worldDraft,
  worldSourceProvider,
} from "./http/validation.js";
import {
  actorStatus,
  boundedNumber,
  draftOperations,
  enumString,
  objectValue,
  optionalBoolean,
  optionalSafeInteger,
  optionalString,
  providerConfigFromRequest,
  readJson,
  requiredNumber,
  requiredString,
  worldActorDefinition,
  worldRelations,
} from "./http/request-parsers.js";
import { requireForegroundRecovery, requireRunningWorld } from "./rooms/guards.js";
import {
  handleSystemRoute,
  parseImageProviderConfig,
} from "./routes/system.js";
import { handleWorldCreateRoute } from "./routes/worlds.js";
import {
  ProviderConcurrencyGate,
  providerConcurrencyLimitFromEnvironment,
  withProviderConcurrencyGate,
} from "./provider-concurrency-gate.js";

// Source bundles contain original text, chunks and a local retrieval index.
// The browser enforces a 64MB aggregate bundle budget before transport.
const MAX_WORLD_REQUEST_BYTES = 96 * 1024 * 1024;
const DEFAULT_PORT = 8787;
const STATIC_ROOT = fileURLToPath(new URL("../../../frontend/dist/", import.meta.url));

export interface WorldServerOptions {
  providerFactory?: (config?: ProviderRequestConfig) => ProviderPair | Promise<ProviderPair>;
  providerConcurrencyLimit?: number;
  registry?: Omit<RoomRegistryOptions, "providerFactory">;
  staticRoot?: string;
  apiKeyConfigured?: boolean;
  debug?: boolean | WorldDebugConfig;
}

export interface WorldServer {
  server: Server;
  registry: WorldRoomRegistry;
  authoring: AuthoringSessionRegistry;
}

export function createWorldServer(options: WorldServerOptions = {}): WorldServer {
  const providerGate = new ProviderConcurrencyGate(
    options.providerConcurrencyLimit ?? providerConcurrencyLimitFromEnvironment(),
  );
  const providerFactory = withProviderConcurrencyGate(
    options.providerFactory ?? createEnvironmentProviders,
    providerGate,
  );
  const apiKeyConfigured = options.apiKeyConfigured ?? hasEnvironmentProviderCredential();
  const debug = options.debug ?? debugConfigFromEnvironment();
  const debugLogWriter = options.registry?.debugEventSink
    ? undefined
    : createDebugLogWriterFromEnvironment();
  const registry = new WorldRoomRegistry({
    providerFactory,
    ...options.registry,
    debug,
    debugEventSink: options.registry?.debugEventSink ?? debugLogWriter?.write,
  });
  const authoring = new AuthoringSessionRegistry({
    providerFactory,
  });
  const staticRoot = options.staticRoot ?? STATIC_ROOT;
  const cleanupTimer = setInterval(() => {
    registry.cleanup();
    authoring.cleanup();
  }, 60_000);
  cleanupTimer.unref();

  const server = createServer(async (request, response) => {
    setCommonHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const providerConfig = providerConfigFromRequest(request);
      const imageProviderConfig = parseImageProviderConfig(request);
      const roomForRequest = async (roomId: string): Promise<WorldRoom> => {
        const room = registry.get(roomId);
        if (!room) throw new HttpError(404, "room_not_found", "世界已失效或服务已重启。");
        await room.updateProviderConfig(providerConfig);
        return room;
      };
      if (await handleSystemRoute({
        request,
        response,
        url,
        providerConfig,
        imageProviderConfig,
        providerFactory,
        apiKeyConfigured,
        customProviderFactory: Boolean(options.providerFactory),
      })) return;
      if (await handleWorldCreateRoute({
        request,
        response,
        url,
        registry,
        providerConfig,
        apiKeyConfigured,
        customProviderFactory: Boolean(options.providerFactory),
      })) return;

      if (url.pathname === "/api/v1/authoring/sessions" && request.method === "POST") {
        if (!hasProviderCredential(providerConfig, apiKeyConfigured, Boolean(options.providerFactory))) {
          throw new HttpError(503, "provider_not_configured", PROVIDER_NOT_CONFIGURED_MESSAGE);
        }
        const body = await readJson(request);
        const runtimeProfile = body.runtimeProfile === undefined
          ? undefined
          : enumString(
              body.runtimeProfile,
              "runtimeProfile",
              ["world_story", "group_chat"] as const,
            );
        const session = await authoring.create({
          draft: body.draft === undefined ? undefined : worldDraft(body.draft, false),
          seed: optionalString(body.seed),
          runtimeProfile,
          providerConfig,
        });
        sendJson(response, 201, { ok: true, session: session.view() });
        return;
      }

      const authoringMatch = /^\/api\/v1\/authoring\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (authoringMatch) {
        const sessionId = decodeURIComponent(authoringMatch[1]!);
        const action = authoringMatch[2];
        const session = authoring.get(sessionId);
        if (!session) throw new HttpError(404, "authoring_session_not_found", "创作会话已失效。");
        await session.updateProviderConfig(providerConfig);

        if (!action && request.method === "GET") {
          sendJson(response, 200, { ok: true, session: session.view() });
          return;
        }
        if (!action && request.method === "DELETE") {
          authoring.delete(sessionId);
          sendJson(response, 200, { ok: true });
          return;
        }
        if (action === "stream" && request.method === "GET") {
          const headerSequence = parseSequence(request.headers["last-event-id"]);
          const querySequence = parseSequence(url.searchParams.get("after"));
          session.attachStream(response, headerSequence ?? querySequence ?? 0);
          return;
        }
        if (action === "log" && request.method === "GET") {
          const after = parseSequence(url.searchParams.get("after")) ?? 0;
          const limit = parseSequence(url.searchParams.get("limit")) ?? 500;
          sendJson(response, 200, {
            ok: true,
            events: session.sessionLog(after, limit),
            harness: session.view().harness,
          });
          return;
        }
        if (action === "messages" && request.method === "POST") {
          const body = await readJson(request, MAX_WORLD_REQUEST_BYTES);
          const result = await session.message(
            requiredString(body.message, "message", 8000),
            sourceMaterials(body.sourceMaterials),
          );
          sendJson(response, 200, {
            ok: true,
            result,
            session: session.view(),
          });
          return;
        }

        if (action === "source-artifact-consume" && request.method === "POST") {
          const body = await readJson(request);
          sendJson(response, 200, {
            ok: true,
            session: session.consumeSourceArtifact(requiredString(body.artifactId, "artifactId", 240)),
          });
          return;
        }

        if (action === "research" && request.method === "POST") {
          const body = await readJson(request);
          const enabled = optionalBoolean(body.enabled, "enabled");
          if (enabled === undefined) {
            throw new HttpError(400, "invalid_request", "enabled 必须是 boolean。");
          }
          sendJson(response, 200, {
            ok: true,
            session: session.setResearchEnabled(enabled),
          });
          return;
        }

        if (action === "operations" && request.method === "POST") {
          const body = await readJson(request);
          const baseRevision = draftRevision(body.baseRevision);
          const operations = draftOperations(body.operations);
          const view = session.applyManualOperations({
            baseRevision,
            operations,
            summary: optionalString(body.summary),
          });
          sendJson(response, 200, { ok: true, session: view });
          return;
        }
        if (action === "undo" && request.method === "POST") {
          sendJson(response, 200, { ok: true, session: session.undo() });
          return;
        }
        if (action === "redo" && request.method === "POST") {
          sendJson(response, 200, { ok: true, session: session.redo() });
          return;
        }
        if (action === "task" && request.method === "POST") {
          const body = await readJson(request);
          const taskAction = enumString(
            body.action,
            "action",
            ["start", "pause", "resume"] as const,
          );
          const view = taskAction === "start"
            ? session.startTask(optionalSafeInteger(body.maxRounds, "maxRounds"))
            : taskAction === "pause"
              ? session.pauseTask()
              : session.resumeTask();
          sendJson(response, 200, { ok: true, session: view });
          return;
        }
        if (action === "preview" && request.method === "POST") {
          const body = await readJson(request, MAX_WORLD_REQUEST_BYTES);
          const preview = await session.preview(
            optionalString(body.playerMessage),
            worldSourceProvider(body.bundles),
          );
          sendJson(response, 200, {
            ok: true,
            preview,
            session: session.view(),
          });
          return;
        }
      }

      const actorRegistryMatch = /^\/api\/v1\/worlds\/([^/]+)\/actors$/.exec(url.pathname);
      if (actorRegistryMatch && request.method === "POST") {
        const roomId = decodeURIComponent(actorRegistryMatch[1]!);
        const room = await roomForRequest(roomId);
        if (room.view().actors.length >= 64) {
          throw new HttpError(409, "actor_capacity_reached", "当前世界最多注册 64 个 Actor。");
        }
        const body = await readJson(request);
        const actor = worldActorDefinition(body.actor);
        if (room.view().actors.some((candidate) => candidate.id === actor.id)) {
          throw new HttpError(409, "actor_exists", `Actor 已存在：${actor.id}`);
        }
        const contextId = optionalString(body.contextId);
        const participation = contextId
          ? (
              body.participation === undefined
                ? "joined"
                : enumString(
                    body.participation,
                    "participation",
                    ["joined", "muted", "left"] as const,
                  )
            ) as ContextParticipation
          : undefined;
        const currentView = room.view();
        if (contextId && !currentView.contexts.some((context) => context.id === contextId)) {
          throw new HttpError(404, "context_not_found", `未知 Context：${contextId}`);
        }
        const actorName = actor.card.name;
        if (
          contextId &&
          participation !== "left" &&
          currentView.actors.some((candidate) => (
            candidate.name === actorName &&
            candidate.contexts.some((context) => (
              context.contextId === contextId && context.participation !== "left"
            ))
          ))
        ) {
          throw new HttpError(
            409,
            "participant_name_conflict",
            `Context 中已经存在名为 ${actorName} 的参与者。`,
          );
        }
        const relations = worldRelations(body.relations);
        const knownActorIds = new Set([
          ...room.view().actors.map((candidate) => candidate.id),
          actor.id,
        ]);
        if (relations.some((relation) => (
          !knownActorIds.has(relation.fromActorId) ||
          !knownActorIds.has(relation.toActorId)
        ))) {
          throw new HttpError(400, "invalid_actor", "relation 引用了未注册的 Actor。");
        }
        if (relations.some((relation) => (
          relation.fromActorId !== actor.id && relation.toActorId !== actor.id
        ))) {
          throw new HttpError(400, "invalid_actor", "新关系必须包含正在注册的 Actor。");
        }
        room.world.registerActor({ actor, relations });
        if (contextId && participation) {
          room.world.setActorParticipation({
            actorId: actor.id,
            contextId,
            participation,
            reason: optionalString(body.reason),
          });
        }
        sendJson(response, 201, { ok: true, view: room.view() });
        return;
      }

      const contextMatch = /^\/api\/v1\/worlds\/([^/]+)\/contexts$/.exec(url.pathname);
      if (contextMatch && request.method === "POST") {
        const roomId = decodeURIComponent(contextMatch[1]!);
        const room = await roomForRequest(roomId);
        const body = await readJson(request);
        const mode = enumString(body.conversationMode, "conversationMode", ["group", "private"] as const);
        if (!Array.isArray(body.actorIds)) {
          throw new HttpError(400, "invalid_actor_ids", "actorIds 必须是数组。");
        }
        const actorIds = body.actorIds.map((value) => requiredString(value, "actorId"));
        const humanActorId = body.humanActorId === undefined
          ? undefined
          : requiredString(body.humanActorId, "humanActorId");
        const name = body.name === undefined ? undefined : optionalString(body.name);
        const topic = body.topic === undefined ? undefined : optionalString(body.topic);
        const contextId = room.createChatContext({
          actorIds,
          conversationMode: mode,
          humanActorId,
          name,
          topic,
        });
        sendJson(response, 201, { ok: true, contextId, view: room.view() });
        return;
      }

      const actorControlMatch = /^\/api\/v1\/worlds\/([^/]+)\/actors\/([^/]+)\/(presence|participation|control)$/.exec(url.pathname);
      if (actorControlMatch && request.method === "POST") {
        const roomId = decodeURIComponent(actorControlMatch[1]!);
        const actorId = decodeURIComponent(actorControlMatch[2]!);
        const action = actorControlMatch[3]!;
        const room = await roomForRequest(roomId);
        const view = room.view();
        const targetActor = view.actors.find((actor) => actor.id === actorId);
        if (!targetActor) {
          throw new HttpError(404, "actor_not_found", `未知 Actor：${actorId}`);
        }
        const body = await readJson(request);
        if (action === "presence") {
          const presence = enumString(
            body.presence,
            "presence",
            ["online", "away", "offline"] as const,
          ) as ActorPresence;
          const status = actorStatus(body);
          room.world.setActorPresence({
            actorId,
            presence,
            ...("status" in body ? { status } : {}),
            reason: optionalString(body.reason),
          });
        } else if (action === "participation") {
          const contextId = requiredString(body.contextId, "contextId");
          if (!view.contexts.some((context) => context.id === contextId)) {
            throw new HttpError(404, "context_not_found", `未知 Context：${contextId}`);
          }
          const participation = enumString(
            body.participation,
            "participation",
            ["joined", "muted", "left"] as const,
          ) as ContextParticipation;
          if (
            participation !== "left" &&
            view.actors.some((actor) => (
              actor.id !== actorId &&
              actor.name === targetActor.name &&
              actor.contexts.some((context) => (
                context.contextId === contextId && context.participation !== "left"
              ))
            ))
          ) {
            throw new HttpError(
              409,
              "participant_name_conflict",
              `Context 中已经存在名为 ${targetActor.name} 的参与者。`,
            );
          }
          room.world.setActorParticipation({
            actorId,
            contextId,
            participation,
            reason: optionalString(body.reason),
          });
        } else if (action === "control") {
          const policy: {
            directorAuthority?: WorldDirectorActorAuthority;
          } = {};
          if (body.directorAuthority !== undefined) {
            policy.directorAuthority = enumString(
              body.directorAuthority,
              "directorAuthority",
              ["observe", "coordinate", "manage"] as const,
            ) as WorldDirectorActorAuthority;
          }
          if (Object.keys(policy).length === 0) {
            throw new HttpError(400, "invalid_request", "必须提供导演权限。");
          }
          room.world.updateActorControlPolicy({ actorId, policy });
        }
        sendJson(response, 200, {
          ok: true,
          actor: room.view().actors.find((actor) => actor.id === actorId),
          view: room.view(),
        });
        return;
      }

      const debugMatch = /^\/api\/v1\/worlds\/([^/]+)\/debug(?:\/(stream))?$/.exec(url.pathname);
      if (debugMatch) {
        const roomId = decodeURIComponent(debugMatch[1]!);
        const room = await roomForRequest(roomId);
        if (!room.debugEnabled) {
          throw new HttpError(404, "debug_disabled", "当前服务未开启世界诊断。");
        }
        if (!debugMatch[2] && request.method === "GET") {
          const requestedLimit = Number(url.searchParams.get("eventLimit"));
          const eventLimit = Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, 2_000)
            : undefined;
          sendJson(response, 200, { ok: true, debug: room.debugView(eventLimit) });
          return;
        }
        if (debugMatch[2] === "stream" && request.method === "GET") {
          const headerSequence = parseSequence(request.headers["last-event-id"]);
          const querySequence = parseSequence(url.searchParams.get("after"));
          room.attachDebugStream(response, headerSequence ?? querySequence ?? 0);
          return;
        }
      }

      const presentationAckMatch = /^\/api\/v1\/worlds\/([^/]+)\/presentation\/ack$/.exec(url.pathname);
      if (presentationAckMatch && request.method === "POST") {
        const roomId = decodeURIComponent(presentationAckMatch[1]!);
        const room = await roomForRequest(roomId);
        requireRunningWorld(room);
        const body = await readJson(request);
        const acknowledgement = room.world.acknowledgePresentation({
          contextId: requiredString(body.contextId, "contextId"),
          turnToken: requiredString(body.turnToken, "turnToken"),
        });
        if (acknowledgement === "too_early") {
          throw new HttpError(409, "presentation_locked", "本幕开场旁白需要先保留十秒，稍后再继续。");
        }
        if (acknowledgement === "stale") {
          throw new HttpError(409, "presentation_stale", "当前演出内容已经更新，请按最新一段继续。");
        }
        sendJson(response, 202, { ok: true, acknowledgement });
        return;
      }

      const presentationModeMatch = /^\/api\/v1\/worlds\/([^/]+)\/presentation\/mode$/.exec(url.pathname);
      if (presentationModeMatch && request.method === "POST") {
        const roomId = decodeURIComponent(presentationModeMatch[1]!);
        const room = await roomForRequest(roomId);
        const body = await readJson(request);
        room.setPresentationMode(
          requiredString(body.contextId, "contextId"),
          enumString(body.mode, "mode", ["world", "stage"] as const),
        );
        sendJson(response, 200, { ok: true, view: room.view() });
        return;
      }

      const presentationSettingsMatch = /^\/api\/v1\/worlds\/([^/]+)\/presentation\/settings$/.exec(url.pathname);
      if (presentationSettingsMatch && request.method === "POST") {
        const roomId = decodeURIComponent(presentationSettingsMatch[1]!);
        const room = await roomForRequest(roomId);
        const body = await readJson(request);
        room.setPresentationPolicy(requiredString(body.contextId, "contextId"), {
          ...(body.presentationPrefetchLimit != null
            ? { presentationPrefetchLimit: requiredNumber(body.presentationPrefetchLimit, "presentationPrefetchLimit") }
            : {}),
        });
        sendJson(response, 200, { ok: true, view: room.view() });
        return;
      }

      const recoveryMatch = /^\/api\/v1\/worlds\/([^/]+)\/recovery\/(retry|dismiss)$/.exec(url.pathname);
      if (recoveryMatch && request.method === "POST") {
        const roomId = decodeURIComponent(recoveryMatch[1]!);
        const action = recoveryMatch[2] as "retry" | "dismiss";
        const room = await roomForRequest(roomId);
        const body = await readJson(request);
        const contextId = requiredString(body.contextId, "contextId");
        const failureId = requiredString(body.failureId, "failureId");
        const recovery = requireForegroundRecovery(room, contextId, failureId);

        if (action === "retry") {
          if (recovery.failure?.retryable !== true) {
            throw new HttpError(409, "recovery_not_retryable", "该错误不能直接重试，请先检查模型配置。");
          }
          requireRunningWorld(room);
          if (!room.world.retryForegroundOperation({ contextId, failureId })) {
            throw new HttpError(409, "recovery_stale", "该恢复操作已经变化，请刷新世界状态后重试。");
          }
          sendJson(response, 202, { ok: true, view: room.view() });
          return;
        }

        if (!room.world.dismissForegroundFailure({ contextId, failureId })) {
          throw new HttpError(409, "recovery_stale", "该恢复操作已经变化，请刷新世界状态后重试。");
        }
        sendJson(response, 200, { ok: true, view: room.view() });
        return;
      }

      const match = /^\/api\/v1\/worlds\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (match) {
        const roomId = decodeURIComponent(match[1]!);
        const action = match[2];
        const room = await roomForRequest(roomId);

        if (!action && request.method === "GET") {
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "archive" && request.method === "GET") {
          response.setHeader("Cache-Control", "no-store");
          sendJson(response, 200, { ok: true, archive: room.archive() });
          return;
        }

        if (action === "stream" && request.method === "GET") {
          const headerSequence = parseSequence(request.headers["last-event-id"]);
          const querySequence = parseSequence(url.searchParams.get("after"));
          room.attachStream(
            response,
            headerSequence ?? querySequence ?? 0,
            optionalString(url.searchParams.get("context")),
          );
          return;
        }

        if (action === "context-pause" && request.method === "POST") {
          const body = await readJson(request);
          room.pauseContext(requiredString(body.contextId, "contextId"));
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "context-resume" && request.method === "POST") {
          const body = await readJson(request);
          room.resumeContext(requiredString(body.contextId, "contextId"));
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "start" && request.method === "POST") {
          if (!room.start()) {
            throw new HttpError(
              409,
              "world_not_startable",
              "这个世界当前不能启动，请根据状态选择继续或重新创建。",
            );
          }
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "messages" && request.method === "POST") {
          const body = await readJson(request);
          const contextId = requiredString(body.contextId, "contextId");
          const actorId = requiredString(body.actorId, "actorId");
          const message = requiredString(body.message, "message", 4000);
          // Main World input and standalone Group Harness input require a
          // running runtime. Private dialogs are the only ask-response
          // surface that may receive a first message while idle or paused.
          requireRunningWorld(room, contextId);
          room.world.sendMessage({ contextId, actorId, message });
          sendJson(response, 202, { ok: true });
          return;
        }

        if (action === "player-card" && request.method === "POST") {
          const body = await readJson(request);
          const actorId = requiredString(body.actorId, "actorId");
          const raw = objectValue(body.card, "card");
          room.updatePlayerCard(actorId, {
            name: requiredString(raw.name, "card.name", 80),
            identity: requiredString(raw.identity, "card.identity", 500),
            background: requiredString(raw.background, "card.background", 2000),
            personality: requiredString(raw.personality, "card.personality", 1000),
            appearance: requiredString(raw.appearance, "card.appearance", 1000),
            speechStyle: requiredString(raw.speechStyle, "card.speechStyle", 1000),
            boundaries: requiredString(raw.boundaries, "card.boundaries", 1000),
          });
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "player-turn" && request.method === "POST") {
          requireRunningWorld(room);
          const body = await readJson(request);
          const skip = body.skip === true;
          const performance = skip ? undefined : objectValue(body.performance, "performance");
          room.world.submitPlayerTurn({
            contextId: requiredString(body.contextId, "contextId"),
            actorId: requiredString(body.actorId, "actorId"),
            proposalId: optionalString(body.proposalId),
            ...(performance ? { performance: {
              message: optionalString(performance.message),
              action: optionalString(performance.action),
            } } : {}),
            ...(skip ? { skip: true } : {}),
          });
          sendJson(response, 202, { ok: true, view: room.view() });
          return;
        }

        if (action === "direction" && request.method === "POST") {
          requireRunningWorld(room);
          const body = await readJson(request);
          const contextId = requiredString(body.contextId, "contextId");
          const direction = requiredString(body.direction, "direction", 4000);
          room.world.changeDirection({ contextId, direction });
          sendJson(response, 202, { ok: true });
          return;
        }

        if (action === "progression" && request.method === "POST") {
          requireRunningWorld(room);
          if (!room.directorEnabled) {
            throw new HttpError(409, "director_disabled", "这个世界已关闭 Director 推进。");
          }
          const body = await readJson(request);
          const contextId = requiredString(body.contextId, "contextId");
          room.world.requestProgression({
            contextId,
            reason: "observer_continue",
          });
          sendJson(response, 202, { ok: true });
          return;
        }

        if (action === "pause" && request.method === "POST") {
          room.pause();
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "resume" && request.method === "POST") {
          room.resume();
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "runtime-policy" && request.method === "POST") {
          const body = await readJson(request);
          const enabled = optionalBoolean(body.autoPauseEnabled, "autoPauseEnabled") ?? true;
          const afterMinutes = enabled
            ? (body.autoPauseAfterMinutes === undefined
              ? 5
              : boundedNumber(body.autoPauseAfterMinutes, "autoPauseAfterMinutes", 1, 120))
            : undefined;
          room.configureRuntime({
            autoPauseAfterMs: afterMinutes === undefined ? undefined : afterMinutes * 60_000,
          });
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "pacing" && request.method === "POST") {
          const body = await readJson(request);
          const contextId = requiredString(body.contextId, "contextId");
          const multiplier = boundedNumber(body.multiplier, "multiplier", 0.25, 20);
          room.setPacingMultiplier(contextId, multiplier);
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }

        if (action === "stop" && request.method === "POST") {
          room.world.stop();
          sendJson(response, 200, { ok: true, view: room.view() });
          return;
        }
      }

      if (request.method === "GET" || request.method === "HEAD") {
        if (serveStatic(response, url.pathname, staticRoot, request.method === "HEAD")) return;
      }

      throw new HttpError(404, "not_found", "未找到请求的资源。");
    } catch (error) {
      handleError(response, error);
    }
  });

  server.on("close", () => {
    clearInterval(cleanupTimer);
    registry.stopAll();
    authoring.stopAll();
    debugLogWriter?.close();
  });

  return { server, registry, authoring };
}


export async function listenWorldServer(
  port = Number(process.env.PORT) || DEFAULT_PORT,
  host = process.env.HOST || "0.0.0.0",
): Promise<WorldServer> {
  const app = createWorldServer();
  await listenHttpServer(app.server, port, host);
  console.log(`ChatVerse World Server listening on http://${host}:${port}`);
  return app;
}

/** Listen without leaving a startup error as an unhandled Server event. */
export function listenHttpServer(
  server: Server,
  port: number,
  host = "0.0.0.0",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export type { ChatProvider };
