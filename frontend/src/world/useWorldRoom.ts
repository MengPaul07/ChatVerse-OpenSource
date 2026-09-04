import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  ActorPresence,
  CharacterCard,
  ContextParticipation,
  GroupCard,
  WorldDirectorActorAuthority,
  PlayerCharacterCard,
  PlayerPerformance,
} from "@chatverse/core";
import { createWorldActorFromCharacter } from "../characterLibrary";
import { saveWorldArchive } from "../worldArchiveLibrary";
import {
  initialWorldRoomState,
  worldRoomReducer,
} from "./reducer";
import type { WorldView } from "./types";
import {
  apiRequest,
} from "./world-room-transport";
import {
  readRuntimePreferences,
  RUNTIME_PREFERENCES_CHANGED,
  syncRoomRuntimePreferences,
} from "../runtimePreferences";
import {
  DEFAULT_WORLD_ROOM_STORAGE_KEY,
  linkedArchiveStorageKey as archiveKeyForRoom,
  worldRoomStorageKey,
} from "../worldStorageKeys";
import { bootstrapWorldRoom } from "./worldRoomBootstrap";
import { useWorldRoomStream } from "./useWorldRoomStream";

const AUTO_SAVE_DEBOUNCE_MS = 500;

export interface UseWorldRoomOptions {
  storageKey?: string;
  worldId?: string;
  /** Context whose chat history and player routing this hook should expose. */
  contextId?: string;
  initialRoomId?: string;
  group?: GroupCard;
  autoCreate?: boolean;
  archiveLibraryId?: string;
}

export interface CreateConversationContextInput {
  conversationMode: "private" | "group";
  actorIds: string[];
  name?: string;
  topic?: string;
}

export function useWorldRoom(options: UseWorldRoomOptions = {}) {
  const worldId = options.worldId;
  const requestedContextId = options.contextId;
  const initialRoomId = options.initialRoomId;
  const storageKey = options.storageKey ?? (
    worldId ? worldRoomStorageKey(worldId) : DEFAULT_WORLD_ROOM_STORAGE_KEY
  );
  const autoCreate = options.autoCreate ?? true;
  const group = options.group;
  const archiveLibraryId = options.archiveLibraryId;
  const [state, dispatch] = useReducer(worldRoomReducer, initialWorldRoomState);
  const [roomId, setRoomId] = useState<string>();
  const [pendingAction, setPendingAction] = useState<string>();
  const [pendingInput, setPendingInput] = useState<string>();
  const [saveState, setSaveState] = useState<{
    status: "idle" | "saving" | "saved" | "error";
    lastSavedAt?: number;
    error?: string;
  }>({ status: "idle" });
  const bootstrapIdentity = useRef<string | undefined>(undefined);
  const actionInFlight = useRef(false);
  const inputInFlight = useRef(false);
  const presentationAckInFlight = useRef(new Set<string>());
  const saveInFlight = useRef<Promise<boolean> | undefined>(undefined);
  const lastStreamSequence = useRef(0);
  const roomIdRef = useRef<string | undefined>(undefined);
  const importantEventSequence = useRef(0);
  const lastSavedEventSequence = useRef(0);
  const linkedArchiveStorageKey = archiveKeyForRoom(storageKey);
  const groupIdentity = group
    ? `${group.metadata.id ?? group.metadata.name}:${group.metadata.version ?? ""}`
    : "none";
  const bootstrapKey = `${storageKey}:${archiveLibraryId ?? "current"}:${worldId ?? "unknown"}:${groupIdentity}`;
  const contextId = state.view?.contexts.find((context) => context.id === requestedContextId)?.id
    ?? state.view?.contexts[0]?.id;

  const loadOrCreateRoom = useCallback(
    (forceNew = false, startAfterCreate = false, skipArchiveRestore = false): Promise<boolean> => (
      bootstrapWorldRoom(
        {
          storageKey,
          worldId,
          initialRoomId,
          group,
          autoCreate,
          archiveLibraryId,
          linkedArchiveStorageKey,
          dispatch,
          setRoomId,
          roomIdRef,
          importantEventSequence,
          lastStreamSequence,
          lastSavedEventSequence,
        },
        forceNew,
        startAfterCreate,
        skipArchiveRestore,
      )
    ),
    [
      archiveLibraryId,
      autoCreate,
      group,
      initialRoomId,
      linkedArchiveStorageKey,
      storageKey,
      worldId,
    ],
  );

  useEffect(() => {
    if (bootstrapIdentity.current === bootstrapKey) return;
    bootstrapIdentity.current = bootstrapKey;
    void loadOrCreateRoom();
  }, [bootstrapKey, loadOrCreateRoom]);

  useWorldRoomStream({
    roomId,
    contextId,
    dispatch,
    lastStreamSequence,
    importantEventSequence,
  });

  useEffect(() => {
    if (!roomId) return;
    const sync = () => void syncRoomRuntimePreferences(roomId, readRuntimePreferences())
      .catch(() => undefined);
    sync();
    window.addEventListener(RUNTIME_PREFERENCES_CHANGED, sync);
    return () => window.removeEventListener(RUNTIME_PREFERENCES_CHANGED, sync);
  }, [roomId]);

  const saveCurrentWorld = useCallback(async (): Promise<boolean> => {
    if (!roomId) return false;
    if (saveInFlight.current) return saveInFlight.current;
    const request = (async () => {
      setSaveState({ status: "saving" });
      try {
        const response = await apiRequest(
          `/api/v1/worlds/${encodeURIComponent(roomId)}/archive`,
        );
        if (!response.ok || !response.archive) {
          throw new Error(response.message || "无法生成世界存档。");
        }
        const record = await saveWorldArchive(response.archive, roomId);
        lastSavedEventSequence.current = response.archive.snapshot.eventSequence;
        localStorage.setItem(linkedArchiveStorageKey, record.libraryId);
        setSaveState({ status: "saved", lastSavedAt: Date.now() });
        return true;
      } catch (error) {
        setSaveState({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        saveInFlight.current = undefined;
      }
    })();
    saveInFlight.current = request;
    return request;
  }, [linkedArchiveStorageKey, roomId]);

  const eventSequence = state.view?.world.eventSequence ?? 0;
  useEffect(() => {
    if (
      importantEventSequence.current <= lastSavedEventSequence.current ||
      !roomId
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveCurrentWorld().then(() => {
        if (importantEventSequence.current > lastSavedEventSequence.current) {
          void saveCurrentWorld();
        }
      });
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [eventSequence, roomId, saveCurrentWorld]);

  const runAction = useCallback(async (
    action: string,
    path: string,
    body?: Record<string, unknown>,
    restoreOnRoomNotFound = true,
  ): Promise<boolean> => {
    if (!roomId || actionInFlight.current) return false;
    actionInFlight.current = true;
    setPendingAction(action);
    try {
      let response = await apiRequest(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/${path}`,
        {
          method: "POST",
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (!response.ok) {
        if (response.code === "room_not_found" && restoreOnRoomNotFound) {
          localStorage.removeItem(storageKey);
          roomIdRef.current = undefined;
          const restored = await loadOrCreateRoom(false);
          const restoredRoomId = roomIdRef.current;
          if (!restored || !restoredRoomId) return false;
          const started = await apiRequest(
            `/api/v1/worlds/${encodeURIComponent(restoredRoomId)}/start`,
            { method: "POST" },
          );
          if (!started.ok || !started.view) return false;
          dispatch({ type: "view_loaded", view: started.view });
          response = await apiRequest(
            `/api/v1/worlds/${encodeURIComponent(restoredRoomId)}/${path}`,
            {
              method: "POST",
              body: body ? JSON.stringify(body) : undefined,
            },
          );
          if (!response.ok) {
            throw new Error(response.message || "世界恢复后仍未能送出这条消息。");
          }
          if (response.view) {
            importantEventSequence.current = Math.max(
              importantEventSequence.current,
              response.view.world.eventSequence,
            );
            dispatch({ type: "view_loaded", view: response.view });
          }
          return true;
        }
        if (response.code === "world_not_running") {
          const refreshed = await apiRequest(`/api/v1/worlds/${encodeURIComponent(roomId)}`);
          if (refreshed.ok && refreshed.view) {
            dispatch({ type: "view_loaded", view: refreshed.view });
            return false;
          }
        }
        throw new Error(response.message || "操作失败。");
      }
      if (response.view) {
        importantEventSequence.current = Math.max(
          importantEventSequence.current,
          response.view.world.eventSequence,
        );
        dispatch({ type: "view_loaded", view: response.view });
      }
      return true;
    } catch (error) {
      dispatch({
        type: "action_error",
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      actionInFlight.current = false;
      setPendingAction(undefined);
    }
  }, [loadOrCreateRoom, roomId, storageKey]);

  const runInputAction = useCallback(async (
    action: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!roomId || inputInFlight.current) return false;
    inputInFlight.current = true;
    setPendingInput(action);
    try {
      const response = await apiRequest(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/${path}`,
        {
          method: "POST",
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (!response.ok) {
        if (response.code === "room_not_found") {
          localStorage.removeItem(storageKey);
          roomIdRef.current = undefined;
          await loadOrCreateRoom(false);
          return false;
        }
        if (response.code === "world_not_running") {
          const refreshed = await apiRequest(`/api/v1/worlds/${encodeURIComponent(roomId)}`);
          if (refreshed.ok && refreshed.view) dispatch({ type: "view_loaded", view: refreshed.view });
          return false;
        }
        throw new Error(response.message || "消息发送失败。");
      }
      if (response.view) {
        importantEventSequence.current = Math.max(
          importantEventSequence.current,
          response.view.world.eventSequence,
        );
        dispatch({ type: "view_loaded", view: response.view });
      }
      return true;
    } catch (error) {
      dispatch({
        type: "action_error",
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      inputInFlight.current = false;
      setPendingInput(undefined);
    }
  }, [loadOrCreateRoom, roomId, storageKey]);

  const createContext = useCallback(async (
    input: CreateConversationContextInput,
  ): Promise<string | undefined> => {
    if (!roomId || actionInFlight.current || input.actorIds.length === 0) return undefined;
    actionInFlight.current = true;
    setPendingAction("context_create");
    try {
      const response = await apiRequest(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/contexts`,
        {
          method: "POST",
          body: JSON.stringify({
            conversationMode: input.conversationMode,
            actorIds: input.actorIds,
            ...(input.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input.topic?.trim() ? { topic: input.topic.trim() } : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(response.message || (input.conversationMode === "private" ? "无法打开私聊。" : "无法创建群聊。"));
      }
      if (response.view) dispatch({ type: "view_loaded", view: response.view });
      return response.contextId;
    } catch (error) {
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    } finally {
      actionInFlight.current = false;
      setPendingAction(undefined);
    }
  }, [roomId]);

  const playerActorId = state.view?.actors.find((actor) => actor.playerControlled)?.id;
  const acknowledgePresentation = useCallback(async (turnToken: string): Promise<boolean> => {
    if (!roomId || !contextId || presentationAckInFlight.current.has(turnToken)) return false;
    presentationAckInFlight.current.add(turnToken);
    try {
      const response = await apiRequest(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/presentation/ack`,
        {
          method: "POST",
          body: JSON.stringify({ contextId, turnToken }),
        },
      );
      if (response.ok) return true;
      if (response.code === "presentation_stale") {
        const refreshed = await apiRequest(`/api/v1/worlds/${encodeURIComponent(roomId)}`);
        if (refreshed.ok && refreshed.view) dispatch({ type: "view_loaded", view: refreshed.view });
        return false;
      }
      throw new Error(response.message || "演出推进失败。");
    } catch (error) {
      dispatch({
        type: "action_error",
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      presentationAckInFlight.current.delete(turnToken);
    }
  }, [contextId, roomId]);
  const setPresentationMode = useCallback(async (mode: "world" | "stage"): Promise<boolean> => {
    if (!roomId || !contextId) return false;
    try {
      const response = await apiRequest(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/presentation/mode`,
        {
          method: "POST",
          body: JSON.stringify({ contextId, mode }),
        },
      );
      if (!response.ok) return false;
      if (response.view) dispatch({ type: "view_loaded", view: response.view });
      await saveCurrentWorld();
      return true;
    } catch {
      return false;
    }
  }, [contextId, roomId, saveCurrentWorld]);
  const setPresentationPolicy = useCallback(async (input: {
    presentationPrefetchLimit?: number;
  }): Promise<boolean> => {
    if (!roomId || !contextId) return false;
    try {
      const response = await apiRequest(
        `/api/v1/worlds/${encodeURIComponent(roomId)}/presentation/settings`,
        {
          method: "POST",
          body: JSON.stringify({ contextId, ...input }),
        },
      );
      if (!response.ok) return false;
      if (response.view) dispatch({ type: "view_loaded", view: response.view });
      await saveCurrentWorld();
      return true;
    } catch {
      return false;
    }
  }, [contextId, roomId, saveCurrentWorld]);
  const retryForegroundOperation = useCallback((failureId: string, targetContextId = contextId) => {
    if (!targetContextId) return Promise.resolve(false);
    return runAction("recovery_retry", "recovery/retry", {
      contextId: targetContextId,
      failureId,
    }, false);
  }, [contextId, runAction]);
  const dismissForegroundFailure = useCallback((failureId: string, targetContextId = contextId) => {
    if (!targetContextId) return Promise.resolve(false);
    return runAction("recovery_dismiss", "recovery/dismiss", {
      contextId: targetContextId,
      failureId,
    }, false);
  }, [contextId, runAction]);

  return {
    state,
    contextId,
    createContext,
    pendingAction,
    pendingInput,
    saveState,
    retry: () => loadOrCreateRoom(false),
    createNewWorld: async () => {
      if (roomId && !await saveCurrentWorld()) return false;
      return loadOrCreateRoom(true, false, false);
    },
    start: async () => {
      const started = roomId
        ? await runAction("start", "start")
        : await loadOrCreateRoom(true, true);
      if (started && roomId) await saveCurrentWorld();
      return started;
    },
    sendMessage: (message: string) => {
      if (!contextId || !playerActorId) return Promise.resolve();
      return runInputAction("message", "messages", {
        contextId,
        actorId: playerActorId,
        message,
      });
    },
    updatePlayerCard: async (card: PlayerCharacterCard) => {
      if (!playerActorId) return Promise.resolve(false);
      const updated = await runAction("player_card", "player-card", { actorId: playerActorId, card });
      if (updated) await saveCurrentWorld();
      return updated;
    },
    submitPlayerTurn: (input: {
      proposalId?: string;
      performance?: PlayerPerformance;
      skip?: boolean;
    }) => {
      if (!contextId || !playerActorId) return Promise.resolve(false);
      return runInputAction("player_turn", "player-turn", {
        contextId,
        actorId: playerActorId,
        ...input,
      });
    },
    acknowledgePresentation,
    setPresentationMode,
    setPresentationPolicy,
    retryForegroundOperation,
    dismissForegroundFailure,
    changeDirection: (direction: string, targetContextId = contextId) => {
      if (!targetContextId) return Promise.resolve(false);
      return runInputAction("direction", "direction", { contextId: targetContextId, direction });
    },
    requestProgression: () => {
      if (!contextId) return Promise.resolve();
      return runAction("progression", "progression", { contextId });
    },
    setPacingMultiplier: (multiplier: number) => {
      if (!contextId) return Promise.resolve(false);
      return runAction("pacing", "pacing", { contextId, multiplier });
    },
    addCharacter: (character: CharacterCard) => {
      if (!contextId) return Promise.resolve(false);
      const actor = createWorldActorFromCharacter(character);
      return runAction("actor", "actors", {
        actor,
        contextId,
        participation: "joined",
        reason: "用户从角色库将角色带入当前世界",
      });
    },
    setActorPresence: (
      actorId: string,
      presence: ActorPresence,
      status?: string,
    ) => runAction("actor_presence", `actors/${encodeURIComponent(actorId)}/presence`, {
      presence,
      ...(status ? { status } : {}),
      reason: "用户在世界管理页调整角色状态",
    }),
    setActorParticipation: (
      actorId: string,
      targetContextId: string,
      participation: ContextParticipation,
    ) => runAction(
      "actor_participation",
      `actors/${encodeURIComponent(actorId)}/participation`,
      {
        contextId: targetContextId,
        participation,
        reason: "用户在世界管理页调整角色参与状态",
      },
    ),
    updateActorControl: (
      actorId: string,
      policy: {
        directorAuthority?: WorldDirectorActorAuthority;
      },
    ) => runAction(
      "actor_control",
      `actors/${encodeURIComponent(actorId)}/control`,
      policy,
    ),
    pause: async () => {
      const paused = await runAction("pause", "pause");
      if (paused) await saveCurrentWorld();
      return paused;
    },
    resume: () => runAction("resume", "resume"),
    pauseContext: async (targetContextId = contextId) => {
      if (!targetContextId) return false;
      const paused = await runAction("context_pause", "context-pause", { contextId: targetContextId });
      if (paused) await saveCurrentWorld();
      return paused;
    },
    resumeContext: async (targetContextId = contextId) => {
      if (!targetContextId) return false;
      const resumed = await runAction("context_resume", "context-resume", { contextId: targetContextId });
      if (resumed) await saveCurrentWorld();
      return resumed;
    },
    save: saveCurrentWorld,
    stop: async () => {
      const stopped = await runAction("stop", "stop");
      if (stopped) await saveCurrentWorld();
      return stopped;
    },
  };
}

export type { WorldView };
