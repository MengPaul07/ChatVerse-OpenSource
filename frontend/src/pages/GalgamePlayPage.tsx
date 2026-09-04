import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Bug,
  ChevronRight,
  Clapperboard,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Pause,
  Play,
  Settings2,
  UserRound,
  Upload,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { PlayerPerformanceOption } from "@chatverse/core";
import WorldRecoveryCard from "../components/WorldRecoveryCard";
import MarkdownContent from "../components/MarkdownContent";
import { useWorldRoomContext } from "../world/WorldRoomContext";
import {
  buildPresentationSegments,
  getVisiblePresentationEntries,
  hasVisibleCurrentTurn,
  selectStageActor,
  selectPresentationTurnEntries,
} from "../world/presentation";
import {
  beginPresentationTransition,
  clearPresentationTransition,
  pendingPresentationTransition,
} from "../world/presentationTransition";
import GalgameStageContent from "../features/galgame/GalgameStageContent";
import { GalgameDrawer, PlayerCardDrawer, Toggle } from "../features/galgame/GalgameDrawers";
import { useGalgameVisualAssets } from "../features/galgame/useGalgameVisualAssets";
import { findWorldTemplate } from "../worldTemplateCatalog";
import { usePlayerAutoPerformance } from "../playerAutomation";

const TYPEWRITER_MS_PER_CHARACTER = 42;

export default function GalgamePlayPage() {
  const { worldId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const room = useWorldRoomContext();
  const view = room.state.view;
  const context = view?.contexts.find((item) => item.id === room.contextId);
  const presentation = context?.presentation;
  const recovery = context?.recovery;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerCardOpen, setPlayerCardOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [autoPlayer, setAutoPlayer] = usePlayerAutoPerformance();
  const [freeInput, setFreeInput] = useState("");
  const [presentationTransitioning, setPresentationTransitioning] = useState(false);
  const [displayedText, setDisplayedText] = useState("");
  const [textComplete, setTextComplete] = useState(false);
  const submittedProposal = useRef<string | undefined>(undefined);
  const acknowledgedTurnTokens = useRef(new Set<string>());
  const advancingTurnToken = useRef<string | undefined>(undefined);
  const requestingTransition = useRef(false);
  const [stageCursor, setStageCursor] = useState<{ token: string; entryIndex: number }>();
  const query = searchParams.toString();
  const backPath = `/worlds/${encodeURIComponent(worldId)}${query ? `?${query}` : ""}`;

  useEffect(() => {
    if (!view || !context || context.presentationMode !== "stage") return;
    const transition = pendingPresentationTransition(view.roomId, context.id, "stage");
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
    if (!presentationTransitioning && context && context.presentationMode !== "stage") navigate(backPath, { replace: true });
  }, [backPath, context, navigate, presentationTransitioning]);

  const entries = useMemo(
    () => view && context ? getVisiblePresentationEntries(view, context) : [],
    [context, view],
  );
  const presentationTurn = context?.presentationTurn;
  const activeTurnVisible = Boolean(view && context && hasVisibleCurrentTurn(view, context));
  const selectedTurnEntries = useMemo(
    () => activeTurnVisible
      ? selectPresentationTurnEntries(entries, context?.presentationTurn?.entryIds ?? [])
      : [],
    [activeTurnVisible, context?.presentationTurn?.entryIds, entries],
  );
  const playbackToken = presentationTurn?.status === "waiting_ack" ? presentationTurn.turnToken : undefined;
  const entryIndex = stageCursor && stageCursor.token === playbackToken ? stageCursor.entryIndex : 0;
  const turnEntries = selectedTurnEntries.length > 0
    ? [selectedTurnEntries[Math.min(entryIndex, selectedTurnEntries.length - 1)]!]
    : [];
  const presentationSegments = useMemo(
    () => buildPresentationSegments(turnEntries),
    [turnEntries],
  );
  const dialogueEntry = [...turnEntries].reverse().find((entry) => entry.kind !== "action");
  const current = dialogueEntry ?? turnEntries.at(-1);
  const currentText = presentationSegments.map((segment) => segment.text).join("\n");
  const presentationTextKey = `${playbackToken ?? "history"}:${turnEntries.map((entry) => entry.id).join(",")}`;
  const playbackReady = Boolean(playbackToken && turnEntries.length > 0);
  const playerTurnVisible = !playbackReady && Boolean(
    context?.playerProposal || context?.presentationTurn?.status === "waiting_player",
  );
  const player = view?.actors.find((actor) => actor.id === presentation?.playerActorId);
  const activeBeat = view?.narrative.beats.find((beat) => beat.status === "running" && beat.contextIds.includes(context?.id ?? ""));
  const template = findWorldTemplate({ worldId, name: view?.world.name });
  const {
    backgroundUrl,
    backgroundStatus,
    backgroundPrompt,
    backgroundBusy,
    backgroundError,
    portraitUrls,
    portraitBusy,
    portraitErrors,
    visualActorId,
    setVisualActorId,
    visualActor,
    portraitPrompt,
    setPortraitPrompt,
    setBackgroundPrompt,
    uploadPortrait,
    generatePortrait,
    regenerateBackground,
    uploadBackground,
  } = useGalgameVisualAssets({ view, context, presentation, activeBeat, bundledStageAssets: template?.assets.stage });
  const templateCoverUrl = template?.assets.cover.src;
  const stageBackgroundUrl = backgroundUrl ?? template?.assets.stage?.background.src ?? templateCoverUrl;
  const activeBeatIndex = activeBeat
    ? view?.narrative.beats.findIndex((beat) => beat.id === activeBeat.id) ?? -1
    : -1;
  const directorBusy = view?.director.status === "running" || view?.director.status === "scheduled";
  const stageBetweenTurns = !playbackReady && !playerTurnVisible;
  const canRequestNextBeat = Boolean(
    stageBetweenTurns &&
    !activeBeat &&
    view?.world.status === "running" &&
    !directorBusy &&
    !room.pendingAction,
  );
  const interludeCopy = activeBeat
    ? {
        eyebrow: activeBeatIndex >= 0 ? `第 ${activeBeatIndex + 1} 幕` : "新幕",
        title: activeBeat.title,
        detail: presentationTurn?.status === "waiting_ack"
          ? "开场内容正在同步到舞台"
          : "开场旁白正在生成",
      }
    : view?.world.status !== "running"
      ? { eyebrow: "幕间", title: "演出已暂停", detail: "从右上角继续世界后，下一幕会接着展开" }
      : directorBusy
        ? { eyebrow: "幕间", title: "下一幕正在编排", detail: "导演正在整理上一幕的结果与新的场景" }
        : { eyebrow: "幕间", title: "故事等待继续", detail: "点击舞台，推进到下一幕" };

  useEffect(() => {
    acknowledgedTurnTokens.current.clear();
    advancingTurnToken.current = undefined;
    setStageCursor(undefined);
    setDisplayedText("");
    setTextComplete(false);
  }, [context?.id]);

  // The server's current turn is the only queue authority. Locally the stage
  // keeps just the entry cursor needed to reveal a multi-entry Actor burst.
  useEffect(() => {
    const turn = presentationTurn;
    if (
      !turn ||
      turn.status !== "waiting_ack" ||
      !activeTurnVisible ||
      selectedTurnEntries.length === 0
    ) {
      return;
    }

    if (acknowledgedTurnTokens.current.has(turn.turnToken)) return;
    setStageCursor((current) => current?.token === turn.turnToken
      ? current
      : { token: turn.turnToken, entryIndex: 0 });
  }, [
    activeTurnVisible,
    presentationTurn,
    selectedTurnEntries,
  ]);

  useEffect(() => {
    const proposal = context?.playerProposal;
    if (!autoPlayer || !proposal || playbackReady || view?.world.status !== "running") return;
    if (submittedProposal.current === proposal.id) return;
    submittedProposal.current = proposal.id;
    void room.submitPlayerTurn({
      proposalId: proposal.id,
      performance: proposal.autoPerformance.performance,
    });
  }, [autoPlayer, context?.playerProposal, playbackReady, room, view?.world.status]);

  // The server commits a complete turn at once. Reveal it locally so a fast
  // provider response still feels like a readable visual-novel scene.
  useLayoutEffect(() => {
    if (!playbackReady) {
      setDisplayedText("");
      setTextComplete(false);
      return;
    }
    const text = currentText;
    const startedAt = Date.now();
    setDisplayedText("");
    setTextComplete(text.length === 0);

    let frame = 0;
    let previousLength = -1;
    let previousComplete = false;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const visibleLength = text.length === 0
        ? 0
        : Math.min(text.length, Math.floor(elapsed / TYPEWRITER_MS_PER_CHARACTER));
      const complete = visibleLength >= text.length;

      if (visibleLength !== previousLength) {
        previousLength = visibleLength;
        setDisplayedText(text.slice(0, visibleLength));
      }
      if (complete !== previousComplete) {
        previousComplete = complete;
        setTextComplete(complete);
      }
      if (!complete) frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [currentText, playbackReady, presentationTextKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, button, a, [role='dialog']")) return;
      if (!playbackToken || !playbackReady) return;
      event.preventDefault();
      if (!textComplete) {
        setDisplayedText(currentText);
        setTextComplete(true);
        return;
      }
      // Space reveals; the mouse click is the deliberate “leave this line” action.
      return;
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentText, playbackReady, playbackToken, textComplete]);

  if (!view || !context) return <div className="galgame-state">正在连接演出舞台...</div>;
  if (!presentation) {
    return (
      <div className="galgame-state">
        <strong>这个 Context 没有启用 Galgame 演出</strong>
        <Link className="button button-primary" to={backPath}>返回世界</Link>
      </div>
    );
  }

  const leavePerformance = async () => {
    if (presentationTransitioning) return;
    const resumeAfterLoad = view.world.status === "running";
    setPresentationTransitioning(true);
    if (resumeAfterLoad && !await room.pause()) {
      setPresentationTransitioning(false);
      return;
    }
    if (!await room.setPresentationMode("world")) {
      if (resumeAfterLoad) await room.resume();
      setPresentationTransitioning(false);
      return;
    }
    beginPresentationTransition({
      roomId: view.roomId,
      contextId: context.id,
      target: "world",
      resumeAfterLoad,
      createdAt: Date.now(),
    });
    navigate(backPath);
  };

  const activeActor = selectStageActor(view.actors, current);
  const requestNextBeat = async () => {
    if (!canRequestNextBeat || requestingTransition.current) return;
    requestingTransition.current = true;
    try {
      await room.requestProgression();
    } finally {
      requestingTransition.current = false;
    }
  };
  const handleStageClick = async () => {
    if (!playbackToken || !playbackReady) {
      await requestNextBeat();
      return;
    }
    if (!textComplete) return;
    if (advancingTurnToken.current === playbackToken || acknowledgedTurnTokens.current.has(playbackToken)) return;
    if (entryIndex < selectedTurnEntries.length - 1) {
      setDisplayedText("");
      setTextComplete(false);
      setStageCursor({ token: playbackToken, entryIndex: entryIndex + 1 });
      return;
    }
    advancingTurnToken.current = playbackToken;
    const accepted = await room.acknowledgePresentation(playbackToken);
    if (!accepted) {
      advancingTurnToken.current = undefined;
      return;
    }
    acknowledgedTurnTokens.current.add(playbackToken);
    setDisplayedText("");
    setTextComplete(false);
    advancingTurnToken.current = undefined;
  };

  const toggleWorld = () => {
    if (room.pendingAction) return;
    if (view.world.status === "running") {
      void room.pause();
      return;
    }
    if (view.world.status === "idle") {
      void room.start();
      return;
    }
    void room.resume();
  };

  const submitOption = (option: PlayerPerformanceOption) => {
    const proposal = context.playerProposal;
    if (!proposal) return;
    void room.submitPlayerTurn({
      proposalId: proposal.id,
      performance: option.performance,
    });
  };

  const skipPlayerTurn = () => {
    const proposal = context.playerProposal;
    void room.submitPlayerTurn({
      ...(proposal ? { proposalId: proposal.id } : {}),
      skip: true,
    });
  };

  return (
    <main className="galgame-stage" onClick={handleStageClick}>
      <div className="galgame-backdrop" style={stageBackgroundUrl ? { backgroundImage: `url(${stageBackgroundUrl})` } : undefined} />
      <header className="galgame-toolbar" onClick={(event) => event.stopPropagation()}>
        <button className="galgame-icon" disabled={presentationTransitioning} onClick={leavePerformance} title="返回世界" aria-label="返回世界">
          <ArrowLeft size={18} />
        </button>
        <div className="galgame-toolbar-title"><strong>{view.world.name}</strong><span>{context.name}{activeBeat ? ` · ${activeBeat.brief.slice(0, 24)}` : ""}</span></div>
        <nav className="galgame-toolbar-actions">
          <span className="galgame-runtime-badge"><Clapperboard size={13} />演出模式</span>
          <button
            className={`galgame-icon galgame-world-toggle ${view.world.status !== "running" ? "is-paused" : ""}`}
            onClick={toggleWorld}
            disabled={Boolean(room.pendingAction) || view.world.status === "stopped"}
            title={view.world.status === "running" ? "暂停世界" : "开始世界"}
            aria-label={view.world.status === "running" ? "暂停世界" : "开始世界"}
          >
            {view.world.status === "running" ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="galgame-icon" onClick={() => setHistoryOpen(true)} title="历史"><BookOpen size={18} /></button>
          <button className="galgame-icon" onClick={() => setToolsOpen(true)} title="舞台工具" aria-label="舞台工具"><MoreHorizontal size={18} /></button>
        </nav>
      </header>
      {view.runtime.providerIssue && recovery?.status !== "failed" && (
        !view.runtime.providerIssue.contextId || view.runtime.providerIssue.contextId === context.id
      ) && (
        <div className="galgame-provider-issue" role="alert" onClick={(event) => event.stopPropagation()}>
          <AlertCircle size={18} />
          <div>
            <strong>{view.runtime.providerIssue.kind === "billing" ? "模型额度不足" : "模型连接需要处理"}</strong>
            <span>{view.runtime.providerIssue.userMessage}</span>
          </div>
          <Link to="/settings/models">检查设置</Link>
        </div>
      )}
      <WorldRecoveryCard
        recovery={recovery}
        variant="stage"
        pending={room.pendingAction === "recovery_retry" || room.pendingAction === "recovery_dismiss"}
        worldRunning={view.world.status === "running"}
        onRetry={(failureId) => void room.retryForegroundOperation(failureId, context.id)}
        onDismiss={(failureId) => void room.dismissForegroundFailure(failureId, context.id)}
      />
      {backgroundStatus === "failed" && <div className="galgame-asset-status" role="status">背景暂不可用，演出继续</div>}

      <GalgameStageContent
        view={view}
        activeActor={activeActor}
        presentationTurn={presentationTurn}
        portraitUrl={activeActor ? portraitUrls[activeActor.id] : undefined}
        stageBetweenTurns={stageBetweenTurns}
        interludeCopy={interludeCopy}
        canRequestNextBeat={canRequestNextBeat}
        playerTurnVisible={playerTurnVisible}
        playerProposal={context.playerProposal}
        freeInput={freeInput}
        playbackReady={playbackReady}
        bufferedTurnCount={context.bufferedPresentationCount ?? 0}
        dialogueEntry={dialogueEntry}
        presentationSegments={presentationSegments}
        displayedText={displayedText}
        textComplete={textComplete}
        onRequestNextBeat={requestNextBeat}
        onFreeInputChange={setFreeInput}
        onSubmitOption={submitOption}
        onSkipPlayerTurn={skipPlayerTurn}
        onSubmitFreeInput={() => {
          const message = freeInput.trim();
          if (!message) return;
          void room.submitPlayerTurn({ performance: { message } });
          setFreeInput("");
        }}
      />

      {toolsOpen && <GalgameDrawer title="舞台工具" onClose={() => setToolsOpen(false)}><div className="galgame-tool-list">
        <button onClick={() => { setToolsOpen(false); setPlayerCardOpen(true); }}><UserRound size={18} /><span><strong>玩家角色卡</strong><small>查看或完善当前世界的身份</small></span><ChevronRight size={17} /></button>
        <button onClick={() => { setToolsOpen(false); setAssetsOpen(true); }}><ImagePlus size={18} /><span><strong>视觉素材</strong><small>管理本幕背景与固定角色立绘</small></span><ChevronRight size={17} /></button>
        <button onClick={() => { setToolsOpen(false); setSettingsOpen(true); }}><Settings2 size={18} /><span><strong>演出设置</strong><small>自动代演与阅读方式</small></span><ChevronRight size={17} /></button>
        <button onClick={() => void (view.world.status === "running" ? room.pause() : room.resume())}><span className="galgame-tool-icon">{view.world.status === "running" ? <Pause size={18} /> : <Play size={18} />}</span><span><strong>{view.world.status === "running" ? "暂停世界" : "继续世界"}</strong><small>控制后台生成与演出推进</small></span><ChevronRight size={17} /></button>
        <Link to={`${backPath.replace(/\?.*$/, "")}/debug${query ? `?${query}` : ""}`} onClick={() => setToolsOpen(false)}><Bug size={18} /><span><strong>运行诊断</strong><small>查看事件和模型调用</small></span><ChevronRight size={17} /></Link>
      </div></GalgameDrawer>}
      {historyOpen && <GalgameDrawer title="演出记录" onClose={() => setHistoryOpen(false)}><div className="galgame-history">{entries.map((entry) => <article key={entry.id}><strong>{entry.kind === "narration" ? "旁白" : entry.actorName}</strong><MarkdownContent content={entry.text} /></article>)}</div></GalgameDrawer>}
      {settingsOpen && <GalgameDrawer title="演出设置" onClose={() => setSettingsOpen(false)}><div className="galgame-settings"><Toggle label="玩家自动代演" checked={autoPlayer} onChange={setAutoPlayer} /><p>对白会逐字呈现。按空格可立即补全文本，文字完整后点击舞台进入下一棒。舞台阅读不控制后台生成，遇到玩家回合时才暂停生成。</p></div></GalgameDrawer>}
      {playerCardOpen && <PlayerCardDrawer actorName={player?.name ?? "你"} complete={player?.playerCardComplete ?? false} initialCard={player?.playerCard} onSave={async (card) => { const ok = await room.updatePlayerCard(card); if (ok) setPlayerCardOpen(false); }} onClose={() => setPlayerCardOpen(false)} />}
      {assetsOpen && <GalgameDrawer title="视觉素材" onClose={() => setAssetsOpen(false)}>
        <div className="galgame-visual-workbench">
          <section>
            <header><div><strong>本幕背景</strong><span>{activeBeat ? "只替换画面，不改变剧情" : "等待本幕开始"}</span></div>{backgroundStatus === "generating" && <LoaderCircle className="is-spinning" size={16} />}</header>
            <div className="galgame-background-preview" style={stageBackgroundUrl ? { backgroundImage: `url(${stageBackgroundUrl})` } : undefined} />
            <label><span>生成提示词</span><textarea rows={5} value={backgroundPrompt} onChange={(event) => setBackgroundPrompt(event.target.value)} /></label>
            {backgroundError && <p className="is-error">{backgroundError}</p>}
            <div className="galgame-asset-actions">
              <label><Upload size={16} />上传成品<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!activeBeat || backgroundBusy} onChange={(event) => void uploadBackground(event.target.files?.[0])} /></label>
              <button type="button" disabled={!activeBeat || backgroundBusy} onClick={() => void regenerateBackground(false)}><ImagePlus size={16} />全新生成</button>
              <button type="button" disabled={!activeBeat || !backgroundUrl || backgroundBusy} onClick={() => void regenerateBackground(true)}><RefreshCw size={16} />参考当前图调整</button>
            </div>
          </section>
          <section>
            <header><div><strong>角色立绘</strong><span>固定素材会跨幕复用</span></div></header>
            <div className="galgame-actor-tabs">{view.actors.filter((actor) => context.actorIds.includes(actor.id)).map((actor) => <button type="button" key={actor.id} className={visualActorId === actor.id ? "is-active" : ""} onClick={() => setVisualActorId(actor.id)}>{actor.name}</button>)}</div>
            {visualActor && <>
              <div className="galgame-portrait-editor">
                {portraitUrls[visualActor.id] ? <img src={portraitUrls[visualActor.id]} alt={visualActor.name} /> : <div className="galgame-asset-placeholder">{visualActor.name.slice(0, 1)}</div>}
                <div><strong>{visualActor.name}</strong><span>{portraitBusy === visualActor.id ? "正在生成，请勿重复点击" : portraitErrors[visualActor.id] || "可上传成品，也可基于当前图继续调整"}</span></div>
              </div>
              <label><span>生成提示词</span><textarea rows={6} value={portraitPrompt} onChange={(event) => setPortraitPrompt(event.target.value)} /></label>
              <div className="galgame-asset-actions">
                <label><Upload size={16} />上传成品<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadPortrait(visualActor.id, event.target.files?.[0])} /></label>
                <button type="button" disabled={Boolean(portraitBusy)} onClick={() => void generatePortrait(visualActor.id, false)}><ImagePlus size={16} />全新生成</button>
                <button type="button" disabled={!portraitUrls[visualActor.id] || Boolean(portraitBusy)} onClick={() => void generatePortrait(visualActor.id, true)}><RefreshCw size={16} />参考当前图调整</button>
              </div>
            </>}
          </section>
        </div>
      </GalgameDrawer>}
      {presentationTransitioning && <div className="presentation-transition-overlay is-stage" role="status" aria-live="polite"><LoaderCircle className="is-spinning" size={20} /><div><strong>正在返回世界视图</strong><span>已暂停演出，正在稳定消息队列与阅读游标…</span></div></div>}
    </main>
  );
}
