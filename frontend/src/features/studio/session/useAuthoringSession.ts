import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyWorldDraft,
  worldDraftFromGroupCard,
  type WorldAuthoringSessionEvent,
  type WorldDraft,
} from "@chatverse/world-authoring";
import { createBlankGroup } from "../../../groupDefaults";
import { getLibraryGroup } from "../../../groupLibrary";
import { getWorldDraft } from "../../../worldDraftLibrary";
import { authoringRequest, errorMessage, parseAuthoringEvent } from "../api/client";
import type { AuthoringSessionView } from "../api/contracts";
import { mergeAuthoringEvents } from "./eventLog";

interface UseAuthoringSessionOptions {
  defaultProfile: "world_story" | "group_chat";
  draftId?: string;
  sourceGroupId?: string;
  onAcceptedDraft: (draft: WorldDraft) => void | Promise<void>;
}

export function useAuthoringSession({
  defaultProfile,
  draftId,
  sourceGroupId,
  onAcceptedDraft,
}: UseAuthoringSessionOptions) {
  const [session, setSession] = useState<AuthoringSessionView>();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const [liveMarkdown, setLiveMarkdown] = useState("");
  const [agentStatusText, setAgentStatusText] = useState("正在理解你的想法");
  const [sessionEvents, setSessionEvents] = useState<WorldAuthoringSessionEvent[]>([]);
  const [researchStatus, setResearchStatus] = useState<"idle" | "searching" | "completed" | "failed">("idle");
  const [researchQuery, setResearchQuery] = useState("");
  const [researchSourceCount, setResearchSourceCount] = useState(0);
  const streamRef = useRef<EventSource | undefined>(undefined);
  const sessionLogIdRef = useRef<string | undefined>(undefined);
  const acceptedDraftHandlerRef = useRef(onAcceptedDraft);
  acceptedDraftHandlerRef.current = onAcceptedDraft;

  const openStream = useCallback((nextSession: AuthoringSessionView) => {
    streamRef.current?.close();
    const stream = new EventSource(`/api/v1/authoring/sessions/${encodeURIComponent(nextSession.id)}/stream?after=${nextSession.lastSequence}`);
    streamRef.current = stream;
    stream.addEventListener("authoring.status", (event) => {
      const payload = parseAuthoringEvent(event);
      const status = payload?.data?.status;
      if (status !== "running" && status !== "previewing" && status !== "idle") return;
      setSession((current) => current ? { ...current, status } : current);
      if (status === "running") {
        const message = payload?.data?.message;
        setAgentStatusText(typeof message === "string" && message.trim() ? message : "正在理解你的想法");
        setLiveMarkdown("");
      } else {
        setAgentStatusText("");
      }
    });
    stream.addEventListener("authoring.agent_delta", (event) => {
      const payload = parseAuthoringEvent(event);
      const delta = payload?.data?.delta;
      if (typeof delta !== "string") return;
      if (payload?.data?.kind === "status") setAgentStatusText(delta);
      else setLiveMarkdown((current) => current + delta);
    });
    stream.addEventListener("authoring.session_event", (event) => {
      const entry = parseAuthoringEvent(event)?.data?.event as WorldAuthoringSessionEvent | undefined;
      if (!entry || typeof entry.sequence !== "number") return;
      setSessionEvents((current) => mergeAuthoringEvents(current, [entry]));
    });
    stream.addEventListener("authoring.research_started", (event) => {
      const query = parseAuthoringEvent(event)?.data?.query;
      setResearchStatus("searching");
      if (typeof query === "string") setResearchQuery(query);
    });
    stream.addEventListener("authoring.research_completed", (event) => {
      const sourceCount = parseAuthoringEvent(event)?.data?.sourceCount;
      setResearchStatus("completed");
      if (typeof sourceCount === "number") setResearchSourceCount(sourceCount);
    });
    stream.addEventListener("authoring.research_failed", (event) => {
      const query = parseAuthoringEvent(event)?.data?.query;
      setResearchStatus("failed");
      if (typeof query === "string") setResearchQuery(query);
    });
    const refresh = () => {
      void authoringRequest(`/api/v1/authoring/sessions/${encodeURIComponent(nextSession.id)}`).then((response) => {
        if (!response.session) return;
        setSession(response.session);
        if (response.session.acceptedDraft.revision > 0) void acceptedDraftHandlerRef.current(response.session.acceptedDraft);
        setLiveMarkdown("");
        setAgentStatusText("");
      }).catch((cause) => setError(errorMessage(cause)));
    };
    for (const eventName of [
      "authoring.agent_result", "authoring.draft_changed", "authoring.plan_changed",
      "authoring.task_changed", "authoring.research_mode_changed", "authoring.research_completed",
      "authoring.error", "resync_required",
    ]) stream.addEventListener(eventName, refresh);
  }, []);

  useEffect(() => {
    if (!session) return;
    if (sessionLogIdRef.current !== session.id) {
      sessionLogIdRef.current = session.id;
      setSessionEvents(session.harness.recentEvents);
      return;
    }
    setSessionEvents((current) => mergeAuthoringEvents(current, session.harness.recentEvents));
  }, [session?.id, session?.harness.lastEventSequence]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    void (async () => {
      try {
        let initialDraft: WorldDraft;
        if (draftId) {
          const record = await getWorldDraft(draftId);
          if (!record) throw new Error("找不到这个世界草稿。");
          initialDraft = record.draft;
        } else if (sourceGroupId) {
          const record = await getLibraryGroup(sourceGroupId);
          if (!record) throw new Error("找不到要编辑的群聊。");
          initialDraft = worldDraftFromGroupCard(record.group, { draftId: record.group.worldRef?.worldId ?? `world:${crypto.randomUUID()}` });
        } else if (defaultProfile === "group_chat") {
          initialDraft = worldDraftFromGroupCard(createBlankGroup(`world:${crypto.randomUUID()}`));
        } else {
          initialDraft = createEmptyWorldDraft({ id: `world:${crypto.randomUUID()}`, name: "未命名世界", runtimeProfile: defaultProfile });
        }
        const response = await authoringRequest("/api/v1/authoring/sessions", { method: "POST", body: JSON.stringify({ draft: initialDraft }) });
        if (!response.session) throw new Error(response.message || "无法创建创作会话。");
        if (cancelled) return;
        setSession(response.session);
        setPhase("ready");
        openStream(response.session);
      } catch (cause) {
        if (cancelled) return;
        setError(errorMessage(cause));
        setPhase("error");
      }
    })();
    return () => { cancelled = true; streamRef.current?.close(); };
  }, [defaultProfile, draftId, openStream, sourceGroupId]);

  const loadSessionLog = useCallback(async () => {
    if (!session) return;
    const response = await authoringRequest(`/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/log?limit=1000`);
    if (response.events) setSessionEvents(response.events);
    if (response.harness) setSession((current) => current ? { ...current, harness: response.harness! } : current);
  }, [session]);

  const resetResearch = useCallback(() => {
    setResearchStatus("idle");
    setResearchQuery("");
  }, []);

  return {
    session, setSession, phase, error, setError, liveMarkdown, agentStatusText,
    sessionEvents, researchStatus, researchQuery, researchSourceCount,
    loadSessionLog, resetResearch,
  };
}
