import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import CharacterLibraryPicker from "../components/CharacterLibraryPicker";
import GuidedTour, { type GuidedTourStep } from "../components/GuidedTour";
import RuntimeVisualAssetsDialog from "../components/RuntimeVisualAssetsDialog";
import WorldEntrySetup from "../components/WorldEntrySetup";
import { generateImageOnce } from "../imageGenerationClient";
import { readImageProviderSettings } from "../imageProviderSettings";
import { findBeatBackground, saveVisualAsset } from "../visualAssetLibrary";
import { buildBeatBackgroundPrompt } from "../visualPromptBuilder";
import type { LibraryCharacterRecord } from "../characterLibrary";
import { findWorldTemplate } from "../worldTemplateCatalog";
import { useWorldRoomContext } from "../world/WorldRoomContext";
import type { PendingWorldEntry } from "../world/story-stream";
import {
  getVisiblePresentationEntries,
  getVisiblePresentationBeats,
  hasVisibleCurrentTurn,
  presentationDrainDelayMs,
  selectPresentationTurnEntries,
} from "../world/presentation";
import { conversationRuntimeState } from "../world/conversationRuntime";
import {
  CommunicationDock,
  PacingControl,
  PresentationTransitionOverlay,
  WorldCommunicationOverlay,
  WorldUnavailable,
} from "../world/world-page-parts";
import { WorldHeader, WorldHero, WorldInspectorPanel, WorldMainStage } from "../world/world-main-panels";
import {
  beginPresentationTransition,
  clearPresentationTransition,
  pendingPresentationTransition,
} from "../world/presentationTransition";
import { markWorldEntryConfigured, worldEntryPreference } from "../worldEntryPreferences";
import { usePlayerAutoPerformance } from "../playerAutomation";
import { completeOnboardingChapter, dismissOnboardingChapter, readOnboardingState } from "../onboarding";

type ComposerMode = "message" | "directive";

export default function WorldPage() {
  const { worldId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedContextId = searchParams.get("context") || undefined;
  const room = useWorldRoomContext();
  const [autoPlayer, setAutoPlayer] = usePlayerAutoPerformance();
  const debugPath = `/worlds/${encodeURIComponent(worldId)}/debug${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const playPath = `/worlds/${encodeURIComponent(worldId)}/play${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const [composerMode, setComposerMode] = useState<ComposerMode>("message");
  const [draft, setDraft] = useState("");
  const [pendingEntry, setPendingEntry] = useState<PendingWorldEntry>();
  const [selectedActorId, setSelectedActorId] = useState<string>();
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  const [actorNotice, setActorNotice] = useState<string>();
  const [presentationTransitioning, setPresentationTransitioning] = useState(false);
  const [visualAssetsOpen, setVisualAssetsOpen] = useState(false);
  const [beatBackgroundUrl, setBeatBackgroundUrl] = useState<string>();
  const view = room.state.view;
  const archiveId = view?.world.archiveId;
  const [configuredArchiveId, setConfiguredArchiveId] = useState<string>();
  const [worldGuideOpen, setWorldGuideOpen] = useState(false);
  const autoGuideTriggeredRef = useRef(false);
  const entryConfigured = Boolean(
    archiveId && (configuredArchiveId === archiveId || worldEntryPreference(archiveId)),
  );
  const requestedContext = view?.contexts.find((candidate) => candidate.id === requestedContextId)
    ?? view?.contexts[0];
  const communicationContext = requestedContext?.conversationMode ? requestedContext : undefined;
  const worldContext = view?.contexts.find((candidate) => !candidate.conversationMode) ?? view?.contexts[0];
  const context = communicationContext ? worldContext : requestedContext;
  const entries = useMemo(
    () => view && context ? getVisiblePresentationEntries(view, context) : [],
    [context, view],
  );
  const beats = useMemo(
    () => view && context ? getVisiblePresentationBeats(view, context, entries) : [],
    [context, entries, view],
  );
  const activeBeat = view?.narrative.beats.find((beat) => beat.status === "running" && beat.contextIds.includes(context?.id ?? ""));
  const worldGuideSteps = useMemo<GuidedTourStep[]>(() => [
    {
      target: "[data-guide='world-navigation']",
      eyebrow: "现场航线 · 01",
      title: "一个世界，不只有聊天窗口",
      description: "左侧可以在现场、任务、剧情、角色和不同通讯空间之间切换。所有页面读取的是同一个持续运行的世界状态。",
    },
    {
      target: "[data-guide='world-stream']",
      eyebrow: "现场航线 · 02",
      title: "这里记录真正发生过的内容",
      description: "旁白、角色回应、你的输入和剧情幕点都会进入时间流。生成中的状态会持续更新，不需要刷新页面。",
    },
    {
      target: "[data-guide='world-composer']",
      eyebrow: "现场航线 · 03",
      title: "说话与改变走向是两种输入",
      description: "正常发送会以你的身份进入场景；“改变走向”会直接发出一条旁白，写入当前局面。",
    },
    {
      target: "[data-guide='world-inspector']",
      eyebrow: "现场航线 · 04",
      title: "剧情和角色状态始终可检查",
      description: "右侧把剧情脉络、当前角色和 Director 状态放在一起。世界变复杂后，这里是理解因果和现场状态的入口。",
    },
  ], []);

  useEffect(() => {
    if (autoGuideTriggeredRef.current || !entryConfigured || !view || view.world.status === "idle") return;
    autoGuideTriggeredRef.current = true;
    if (readOnboardingState().chapters.world === "pending") setWorldGuideOpen(true);
  }, [entryConfigured, view]);

  useEffect(() => {
    if (!view || !context || !activeBeat) { setBeatBackgroundUrl(undefined); return; }
    let cancelled = false;
    let objectUrl: string | undefined;
    void (async () => {
      let asset = await findBeatBackground(view.world.archiveId, activeBeat.id);
      if (!asset) {
        const settings = readImageProviderSettings();
        if (!settings.apiKey) return;
        const prompt = buildBeatBackgroundPrompt({ artDirection: context.presentation?.artDirection, worldName: view.world.name, beatBrief: activeBeat.brief, sceneNow: context.scene.text });
        const result = await generateImageOnce(`beat-background:${view.world.archiveId}:${activeBeat.id}`, settings, prompt, settings.landscapeSize);
        asset = { id: `beat-background:${view.world.archiveId}:${activeBeat.id}`, kind: "beat_background", ownerId: context.id, archiveId: view.world.archiveId, beatId: activeBeat.id, blob: result.blob, mimeType: result.mimeType, prompt, model: result.model, createdAt: Date.now() };
        await saveVisualAsset(asset);
      }
      if (cancelled) return;
      objectUrl = URL.createObjectURL(asset.blob);
      setBeatBackgroundUrl(objectUrl);
    })().catch(() => undefined);
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [activeBeat?.id, context?.id, view?.world.archiveId]);

  useEffect(() => {
    if (!view || !context || context.presentationMode !== "world") return;
    const transition = pendingPresentationTransition(view.roomId, context.id, "world");
    if (!transition) return;
    setPresentationTransitioning(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        if (transition.resumeAfterLoad) await room.resume();
        clearPresentationTransition();
        setPresentationTransitioning(false);
      })();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [context?.id, context?.presentationMode, view?.roomId]);

  useEffect(() => {
    if (!presentationTransitioning && context?.presentationMode === "stage" && view?.world.status !== "idle") navigate(playPath, { replace: true });
  }, [context?.presentationMode, navigate, playPath, presentationTransitioning, view?.world.status]);

  const autoAcknowledgedToken = useRef<string | undefined>(undefined);
  const presentationTurnToken = context?.presentationTurn?.turnToken;
  const presentationAcknowledgeAfter = context?.presentationTurn?.acknowledgeAfter;
  const bufferedPresentationCount = context?.bufferedPresentationCount ?? 0;
  const currentPresentationEntries = useMemo(
    () => selectPresentationTurnEntries(entries, context?.presentationTurn?.entryIds ?? []),
    [context?.presentationTurn?.entryIds, entries],
  );
  const currentPresentationLength = currentPresentationEntries.reduce(
    (total, entry) => total + [...entry.text.trim()].length,
    0,
  );
  const hasCurrentPresentation = Boolean(view && context && hasVisibleCurrentTurn(view, context));
  useEffect(() => {
    if (!view || !context || context.presentationMode === "stage") return;
    if (view.world.status !== "running") return;
    const turn = context.presentationTurn;
    if (!turn || turn.status !== "waiting_ack" || !hasCurrentPresentation) return;
    if (autoAcknowledgedToken.current === turn.turnToken) return;
    const delay = presentationDrainDelayMs(
      currentPresentationEntries,
      context.pacingMultiplier,
      bufferedPresentationCount,
      turn.acknowledgeAfter,
    );
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void room.acknowledgePresentation(turn.turnToken).then((accepted) => {
        if (accepted && !cancelled) autoAcknowledgedToken.current = turn.turnToken;
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    context?.id,
    context?.presentationMode,
    hasCurrentPresentation,
    presentationAcknowledgeAfter,
    bufferedPresentationCount,
    currentPresentationLength,
    context?.pacingMultiplier,
    presentationTurnToken,
    room.acknowledgePresentation,
    view?.world.status,
  ]);

  useEffect(() => {
    if (!pendingEntry) return;
    const committed = entries.some((entry) => (
      entry.kind === pendingEntry.kind &&
      entry.text === pendingEntry.text &&
      entry.occurredAt >= pendingEntry.createdAt - 2_000
    ));
    if (committed) setPendingEntry(undefined);
  }, [entries, pendingEntry]);

  if (room.state.phase === "error" || !view) {
    return (
      <WorldUnavailable
        message={room.state.error ?? "世界没有正确加载。"}
        onRetry={room.retry}
        onReset={() => navigate("/groups")}
        resetLabel="换一个世界"
      />
    );
  }

  const isCommunicationOpen = Boolean(communicationContext);
  const isPrivateCommunication = communicationContext?.conversationMode === "private";
  const isGalgameContext = context?.presentation?.kind === "galgame";
  const isConversation = context?.conversationMode === "group" || context?.conversationMode === "private";
  const isPrivateConversation = context?.conversationMode === "private";
  const isGroupConversation = context?.conversationMode === "group";
  const groupRuntime = isGroupConversation && context
    ? conversationRuntimeState("group", context.status)
    : undefined;
  const surfaceIdle = isGroupConversation ? !groupRuntime?.active : view.world.status === "idle";
  const worldTemplate = findWorldTemplate({ worldId, name: view.world.name });
  const worldCover = worldTemplate?.assets.cover;
  const effectiveMode: ComposerMode = isConversation ? "message" : composerMode;
  const sceneActors = view.actors.filter((actor) => (
    (actor.contexts ?? []).some((presence) => (
      presence.contextId === context?.id &&
      presence.participation === "joined"
    ))
  ));
  const playerProposal = context?.playerProposal;
  const waitingForPlayer = !isConversation && context?.presentationTurn?.status === "waiting_player" &&
    context.presentationTurn.participant.type === "player";
  const submittedAutoProposal = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (
      !autoPlayer || isConversation || !playerProposal || room.pendingInput ||
      view.world.status !== "running" || submittedAutoProposal.current === playerProposal.id
    ) return;
    submittedAutoProposal.current = playerProposal.id;
    void room.submitPlayerTurn({
      proposalId: playerProposal.id,
      performance: playerProposal.autoPerformance.performance,
    });
  }, [autoPlayer, isConversation, playerProposal, room, view.world.status]);
  const canSubmit = room.state.phase === "ready" && !room.pendingInput && (
    isPrivateConversation
      ? context != null && conversationRuntimeState("private", context.status).canSend
      : isGroupConversation
        ? Boolean(groupRuntime?.canSend)
        : view.world.status === "running"
  );

  const closeParams = new URLSearchParams(searchParams);
  closeParams.delete("context");
  closeParams.set("room", view.roomId);
  const communicationClosePath = `/worlds/${encodeURIComponent(worldId)}?${closeParams.toString()}`;

  async function submit() {
    const content = draft.trim();
    if (!content || !canSubmit) return;
    setDraft("");
    if (effectiveMode !== "directive") {
      setPendingEntry({ kind: "human", text: content, createdAt: Date.now() });
    }
    const accepted = effectiveMode === "directive"
      ? await room.changeDirection(content, context?.id)
      : await room.sendMessage(content);
    if (accepted === false) {
      setPendingEntry(undefined);
      setActorNotice("走向调整失败，请稍后再试。");
    } else if (effectiveMode === "directive") {
      setActorNotice("Narrator 正在把你的意图转化为当前局面。");
    }
  }

  async function addCharacter(record: LibraryCharacterRecord) {
    const added = await room.addCharacter(record.character);
    if (added) setActorNotice(`${record.character.name} 已来到当前场景。`);
    return added;
  }

  function focusActor(actorName: string) {
    setComposerMode("message");
    setDraft(`@${actorName} `);
    setSelectedActorId(undefined);
  }

  async function openPrivateChat(actorId: string) {
    const contextId = await room.createContext({ conversationMode: "private", actorIds: [actorId] });
    if (!contextId || !view) return;
    const next = new URLSearchParams(searchParams);
    next.set("context", contextId);
    next.set("room", view.roomId);
    navigate(`/worlds/${encodeURIComponent(worldId)}?${next.toString()}`);
  }

  async function enterPerformance() {
    if (!context || !view || presentationTransitioning) return;
    const resumeAfterLoad = view.world.status === "running";
    setPresentationTransitioning(true);
    if (resumeAfterLoad && !await room.pause()) {
      setPresentationTransitioning(false);
      return;
    }
    if (!await room.setPresentationMode("stage")) {
      if (resumeAfterLoad) await room.resume();
      setPresentationTransitioning(false);
      return;
    }
    beginPresentationTransition({
      roomId: view.roomId,
      contextId: context.id,
      target: "stage",
      resumeAfterLoad,
      createdAt: Date.now(),
    });
    navigate(playPath);
  }

  function submitPlayerPerformance(performance: { message?: string; action?: string }) {
    if (!playerProposal || room.pendingInput) return;
    void room.submitPlayerTurn({ proposalId: playerProposal.id, performance });
  }

  return (
    <div className={`world-page page-enter${isConversation ? " is-conversation" : ""}${isCommunicationOpen ? " has-communication-overlay" : ""}`}>
      <WorldHeader
        debugPath={debugPath}
        view={view}
        context={context}
        room={room}
        isPrivateConversation={isPrivateConversation}
        isGroupConversation={isGroupConversation}
        groupRuntime={groupRuntime}
        onOpenGuide={() => setWorldGuideOpen(true)}
      />
      <WorldHero
        view={view}
        context={context}
        isConversation={isConversation}
        isPrivateConversation={isPrivateConversation}
        beatBackgroundUrl={beatBackgroundUrl}
        worldCover={worldCover}
        onOpenVisualAssets={() => setVisualAssetsOpen(true)}
      />

      <div className={`world-workspace ${surfaceIdle ? "is-idle" : ""} ${isConversation ? "is-conversation" : ""}`}>
        <WorldMainStage
          view={view}
          context={context}
          entries={entries}
          beats={beats}
          room={room}
          isGalgameContext={isGalgameContext}
          isConversation={isConversation}
          isPrivateConversation={isPrivateConversation}
          isGroupConversation={isGroupConversation}
          surfaceIdle={surfaceIdle}
          groupRuntime={groupRuntime}
          effectiveMode={effectiveMode}
          draft={draft}
          setDraft={setDraft}
          setComposerMode={(mode) => setComposerMode(mode)}
          canSubmit={canSubmit}
          pendingEntry={pendingEntry}
          waitingForPlayer={waitingForPlayer}
          playerProposal={playerProposal}
          presentationTransitioning={presentationTransitioning}
          onSubmit={submit}
          onEnterPerformance={() => void enterPerformance()}
          onSubmitPlayerPerformance={submitPlayerPerformance}
          autoPlayer={autoPlayer}
          onAutoPlayerChange={setAutoPlayer}
        />

        <WorldInspectorPanel
          view={view}
          sceneActors={sceneActors}
          selectedActorId={selectedActorId}
          setSelectedActorId={setSelectedActorId}
          actorNotice={actorNotice}
          isConversation={isConversation}
          room={room}
          onOpenCharacterLibrary={() => setShowCharacterLibrary(true)}
          onFocusActor={focusActor}
          onOpenPrivateChat={openPrivateChat}
        />
      </div>
      <CommunicationDock
        view={view}
        activeContextId={communicationContext?.id}
        worldId={worldId}
        roomId={view.roomId}
        onOpen={(contextId) => {
          const next = new URLSearchParams(searchParams);
          next.set("context", contextId);
          next.set("room", view.roomId);
          navigate(`/worlds/${encodeURIComponent(worldId)}?${next.toString()}`);
        }}
      />
      {!isPrivateConversation && context && (
        <PacingControl
          value={context.pacingMultiplier}
          disabled={room.state.phase !== "ready" || view.world.status === "stopped" || room.pendingAction === "pacing"}
          onChange={room.setPacingMultiplier}
        />
      )}
      {communicationContext && (
        <WorldCommunicationOverlay
          view={view}
          room={room}
          context={communicationContext}
          worldContext={worldContext}
          worldId={worldId}
          closePath={communicationClosePath}
          isPrivate={isPrivateCommunication}
        />
      )}
      <CharacterLibraryPicker
        open={showCharacterLibrary}
        title={`邀请角色进入${context?.name ?? view.world.name}`}
        description="从本地角色库选择一张卡。角色会注册到本次世界，并立即加入当前场景。"
        existingNames={view.actors.map((actor) => actor.name)}
        onClose={() => setShowCharacterLibrary(false)}
        onSelect={addCharacter}
      />
      {!isConversation && context && view.world.status === "idle" && !entryConfigured && (
        <WorldEntrySetup
          view={view}
          context={context}
          room={room}
          onStarted={(mode) => {
            markWorldEntryConfigured(view.world.archiveId, mode);
            setConfiguredArchiveId(view.world.archiveId);
            if (mode === "stage") navigate(playPath);
          }}
        />
      )}
      {presentationTransitioning && <PresentationTransitionOverlay target="stage" />}
      {visualAssetsOpen && context && <RuntimeVisualAssetsDialog view={view} context={context} onClose={() => setVisualAssetsOpen(false)} onBackgroundChanged={(blob) => setBeatBackgroundUrl((previous) => { if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous); return URL.createObjectURL(blob); })} />}
      <GuidedTour
        label="第一次进入世界"
        steps={worldGuideSteps}
        open={worldGuideOpen}
        onOpenChange={setWorldGuideOpen}
        onComplete={() => completeOnboardingChapter("world")}
        onDismiss={() => dismissOnboardingChapter("world")}
      />
    </div>
  );
}
