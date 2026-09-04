import { useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  CircleHelp,
  Compass,
  GitBranch,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Save,
  RefreshCw,
  Send,
  Square,
  UserPlus,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { WorldRoomController } from "./WorldRoomContext";
import { conversationRuntimeState } from "./conversationRuntime";
import { NarrativeGraph, StoryStream, type PendingWorldEntry } from "./story-stream";
import {
  actorColor,
  availabilityLabel,
  contextStatusLabel,
  ConnectionStatus,
  directorStatusDetail,
  directorStatusTitle,
  presenceLabel,
  saveButtonTitle,
} from "./world-page-parts";
import type { WorldView, WorldViewEntry } from "./types";
import type { WorldTemplateImageAsset } from "../worldTemplateCatalog";

type ComposerMode = "message" | "directive";
type WorldContextView = WorldView["contexts"][number];
type PlayerProposal = NonNullable<WorldContextView["playerProposal"]>;
type GroupRuntime = ReturnType<typeof conversationRuntimeState>;
type PlayerPerformance = { message?: string; action?: string };

export function WorldHeader({
  debugPath,
  view,
  context,
  room,
  isPrivateConversation,
  isGroupConversation,
  groupRuntime,
  onOpenGuide,
}: {
  debugPath: string;
  view: WorldView;
  context?: WorldContextView;
  room: WorldRoomController;
  isPrivateConversation: boolean;
  isGroupConversation: boolean;
  groupRuntime?: GroupRuntime;
  onOpenGuide: () => void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <header className="world-topbar">
      <div className="world-topbar-leading">
        <Link className="world-back-link" to="/">
          <ArrowLeft size={16} />
          <span>探索</span>
        </Link>
        <div className="world-breadcrumb">
          <BookOpen size={16} />
          <span>我的世界</span>
          <ChevronRight size={14} />
          <strong>{view.world.name}</strong>
        </div>
      </div>
      <div className="world-topbar-actions">
        <button
          className="icon-button world-topbar-more"
          type="button"
          title="更多世界工具"
          aria-label="更多世界工具"
          aria-expanded={toolsOpen}
          aria-controls="world-topbar-tools"
          onClick={() => setToolsOpen((open) => !open)}
        >
          <MoreHorizontal size={17} />
        </button>
        <div
          className={`world-topbar-tools${toolsOpen ? " is-open" : ""}`}
          id="world-topbar-tools"
          onClick={() => setToolsOpen(false)}
        >
          <button className="icon-button onboarding-world-launcher" type="button" title="打开世界功能引导" aria-label="打开世界功能引导" onClick={onOpenGuide}><CircleHelp size={16} /></button>
          <Link className="world-showcase-switch-link" to="/showcase"><Workflow size={15} /><span>编排展示</span></Link>
          {isGroupConversation && groupRuntime && room.state.connection === "open" ? (
            <span className={`world-status is-${groupRuntime.active ? "running" : "idle"}`}>
              <i />{groupRuntime.active ? "群聊运行中" : groupRuntime.paused ? "群聊已暂停" : "群聊等待开始"}
            </span>
          ) : (
            <ConnectionStatus view={view} connection={room.state.connection} />
          )}
          <Link className="icon-button" to={debugPath} title="打开 Debug" aria-label="打开 Debug">
            <Bug size={16} />
          </Link>
          <button
            className="icon-button"
            title={saveButtonTitle(room.saveState)}
            aria-label="保存进度"
            onClick={() => void room.save()}
            disabled={room.saveState.status === "saving"}
          >
            {room.saveState.status === "saving"
              ? <LoaderCircle className="is-spinning" size={16} />
              : room.saveState.status === "saved"
                ? <Check size={16} />
                : <Save size={16} />}
          </button>
          {!isPrivateConversation && ((isGroupConversation ? groupRuntime?.active : view.world.status === "running") ? (
            <button className="icon-button" title={isGroupConversation ? "暂停当前群聊" : "暂停世界"} aria-label={isGroupConversation ? "暂停当前群聊" : "暂停世界"} onClick={() => void (isGroupConversation && context ? room.pauseContext(context.id) : room.pause())}>
              <Pause size={16} />
            </button>
          ) : (isGroupConversation ? groupRuntime?.paused || groupRuntime?.canStart : view.world.status === "paused") ? (
            <button className="icon-button" title={isGroupConversation ? (groupRuntime?.canStart ? "开始当前群聊" : "继续当前群聊") : "继续世界"} aria-label={isGroupConversation ? (groupRuntime?.canStart ? "开始当前群聊" : "继续当前群聊") : "继续世界"} onClick={() => void (isGroupConversation && context ? room.resumeContext(context.id) : room.resume())}>
              <Play size={16} />
            </button>
          ) : !isGroupConversation && view.world.status === "idle" ? (
            <button
              className="icon-button"
              title="开始世界"
              aria-label="开始世界"
              onClick={room.start}
              disabled={Boolean(room.pendingAction)}
            >
              {room.pendingAction === "start"
                ? <LoaderCircle className="is-spinning" size={16} />
                : <Play size={16} />}
            </button>
          ) : null)}
          {!isPrivateConversation && !isGroupConversation && (view.world.status === "running" || view.world.status === "paused" ? (
            <button className="icon-button" title="停止世界" aria-label="停止世界" onClick={room.stop}>
              <Square size={15} />
            </button>
          ) : null)}
        </div>
        {toolsOpen && <button className="world-topbar-tools-scrim" type="button" aria-label="关闭世界工具" onClick={() => setToolsOpen(false)} />}
      </div>
    </header>
  );
}

export function WorldHero({
  view,
  context,
  isConversation,
  isPrivateConversation,
  beatBackgroundUrl,
  worldCover,
  onOpenVisualAssets,
}: {
  view: WorldView;
  context?: WorldContextView;
  isConversation: boolean;
  isPrivateConversation: boolean;
  beatBackgroundUrl?: string;
  worldCover?: WorldTemplateImageAsset;
  onOpenVisualAssets: () => void;
}) {
  return (
    <section
      className="world-hero"
      style={!isConversation && (beatBackgroundUrl || worldCover) ? {
        backgroundColor: worldCover?.dominantColor,
        backgroundImage: `url(${beatBackgroundUrl || worldCover?.src})`,
        backgroundPosition: `${(worldCover?.focalPoint?.x ?? 0.5) * 100}% ${(worldCover?.focalPoint?.y ?? 0.5) * 100}%`,
      } : undefined}
    >
      <div className="world-hero-shade" />
      <div className="world-hero-copy">
        <p className="world-kicker">
          {isConversation
            ? isPrivateConversation
              ? "私聊对话 · 不推进主世界"
              : "独立群聊 · Harness 自主运行"
            : `实时世界 · ${view.world.status === "idle" ? "等待开始" : "正在发生"}`}
        </p>
        <h1>{view.world.name}</h1>
        <p>{view.world.description}</p>
        <div className="world-hero-meta">
          <span><Compass size={15} />{context?.name ?? "世界中"}</span>
          <span><GitBranch size={15} />{view.narrative.beats.length} 个已提交剧情节点</span>
        </div>
      </div>
      {!isConversation && context && <button className="world-hero-visual-action" type="button" onClick={onOpenVisualAssets}><ImagePlus size={16} /><span>视觉素材</span></button>}
      {isConversation && (
        <div className="conversation-surface-badge">
          <MessageCircle size={15} />
          <span>{context?.conversationMode === "private" ? "一对一问答" : "Harness 群聊"}</span>
        </div>
      )}
    </section>
  );
}

interface WorldMainStageProps {
  view: WorldView;
  context?: WorldContextView;
  entries: WorldViewEntry[];
  beats: WorldView["narrative"]["beats"];
  room: WorldRoomController;
  isGalgameContext: boolean;
  isConversation: boolean;
  isPrivateConversation: boolean;
  isGroupConversation: boolean;
  surfaceIdle: boolean;
  groupRuntime?: GroupRuntime;
  effectiveMode: ComposerMode;
  draft: string;
  setDraft: (value: string) => void;
  setComposerMode: (mode: ComposerMode) => void;
  canSubmit: boolean;
  pendingEntry?: PendingWorldEntry;
  waitingForPlayer: boolean;
  playerProposal?: PlayerProposal;
  presentationTransitioning: boolean;
  onSubmit: () => void | Promise<void>;
  onEnterPerformance: () => void;
  onSubmitPlayerPerformance: (performance: PlayerPerformance) => void;
  autoPlayer: boolean;
  onAutoPlayerChange: (enabled: boolean) => void;
}

export function WorldMainStage({
  view,
  context,
  entries,
  beats,
  room,
  isGalgameContext,
  isConversation,
  isPrivateConversation,
  isGroupConversation,
  surfaceIdle,
  groupRuntime,
  effectiveMode,
  draft,
  setDraft,
  setComposerMode,
  canSubmit,
  pendingEntry,
  waitingForPlayer,
  playerProposal,
  presentationTransitioning,
  onSubmit,
  onEnterPerformance,
  onSubmitPlayerPerformance,
  autoPlayer,
  onAutoPlayerChange,
}: WorldMainStageProps) {
  return (
    <main className={`world-stage ${surfaceIdle ? "is-idle" : ""} ${isConversation ? "is-conversation" : ""}`}>
      <section className={`scene-context${isGalgameContext ? " has-focus-action" : ""}`} aria-label="当前场景">
        <div className="scene-context-copy">
          <p className="eyebrow">此刻</p>
          <strong>{context?.name ?? "未知场景"} · {contextStatusLabel(context?.status)}</strong>
          {!isConversation && (
            <span className="context-driver-state is-narrator">
              <Workflow size={12} />
              Narrator · 统一调度
            </span>
          )}
        </div>
        <p>{context?.scene?.text || "世界正在等待新的事实。"}</p>
        {isGalgameContext && (
          <button
            className="scene-focus-action"
            type="button"
            onClick={onEnterPerformance}
            disabled={Boolean(room.pendingAction) || presentationTransitioning}
          >
            <span className="scene-focus-action-icon"><Clapperboard size={17} /></span>
            <span>
              <strong>
                {context?.presentationTurn?.status === "waiting_player"
                  ? "轮到你了"
                  : context?.presentationTurn?.status === "waiting_ack"
                    ? "继续演出"
                    : presentationTransitioning ? "正在切换舞台" : "进入演出"}
              </strong>
              <small>
                {context?.presentationTurn?.status === "waiting_player"
                  ? "进入舞台作出回应"
                  : context?.presentationTurn?.status === "waiting_ack"
                    ? "从当前台词继续"
                    : (context?.bufferedPresentationCount ?? 0) > 0
                      ? `${context?.bufferedPresentationCount} 段内容已准备`
                      : "保留当前剧情，打开视觉小说视图"}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        )}
      </section>

      <StoryStream
        entries={entries}
        beats={beats}
        directorStatus={view.director.status}
        pendingEntry={pendingEntry}
        providerIssue={
          context?.recovery?.status !== "failed" && (
            !view.runtime.providerIssue?.contextId || view.runtime.providerIssue.contextId === context?.id
          )
            ? view.runtime.providerIssue
            : undefined
        }
        recovery={context?.recovery}
        recoveryPending={room.pendingAction === "recovery_retry" || room.pendingAction === "recovery_dismiss"}
        worldRunning={view.world.status === "running"}
        streamingEntryIds={context?.presentationMode === "world" && context.presentationTurn?.status === "waiting_ack" ? context.presentationTurn.entryIds : []}
        pacingMultiplier={context?.pacingMultiplier ?? 1}
        onRetryRecovery={(failureId) => { if (context) void room.retryForegroundOperation(failureId, context.id); }}
        onDismissRecovery={(failureId) => { if (context) void room.dismissForegroundFailure(failureId, context.id); }}
      />

      {!isPrivateConversation && (isGroupConversation ? !groupRuntime?.active && !groupRuntime?.stopped : view.world.status === "idle") && (
        <div className="world-terminal-state world-ready-state">
          <Play size={18} />
          <div>
            <strong>{isGroupConversation ? (groupRuntime?.paused ? "群聊已暂停" : "群聊正在等待开始") : "世界正在等待你"}</strong>
            <span>{isGroupConversation ? (groupRuntime?.paused ? "继续后，角色会恢复各自的 idle 节奏。" : "开始后，角色会按各自的 idle 节奏自主参与。") : "开始后，第一幕会出现，角色也会从这一刻开始行动。"}</span>
          </div>
          <button
            className="button button-primary"
            onClick={() => void (isGroupConversation && context ? room.resumeContext(context.id) : room.start())}
            disabled={Boolean(room.pendingAction)}
          >
            {room.pendingAction === (isGroupConversation ? "context_resume" : "start")
              ? <LoaderCircle className="is-spinning" size={16} />
              : <Play size={16} />}
            {isGroupConversation && groupRuntime?.paused ? "继续" : "开始"}
          </button>
        </div>
      )}
      {!isPrivateConversation && (isGroupConversation ? groupRuntime?.stopped : view.world.status === "stopped") && (
        <div className="world-terminal-state">
          <Square size={17} />
          <div><strong>{isGroupConversation ? "这个群聊已停止" : "这个世界已停止"}</strong><span>未完成的生成已取消，可以重新开始一个独立运行。</span></div>
          <button className="button button-primary" onClick={room.createNewWorld}>
            <RefreshCw size={16} />重新开始
          </button>
        </div>
      )}
      {waitingForPlayer ? (
        <PlayerTurnPanel
          draft={draft}
          setDraft={setDraft}
          playerProposal={playerProposal}
          autoPlayer={autoPlayer}
          onAutoPlayerChange={onAutoPlayerChange}
          onSubmitPlayerPerformance={onSubmitPlayerPerformance}
          onSkip={() => {
            if (playerProposal) void room.submitPlayerTurn({ proposalId: playerProposal.id, skip: true });
          }}
          pendingInput={Boolean(room.pendingInput)}
        />
      ) : (
        <WorldComposer
          isConversation={isConversation}
          isPrivateConversation={isPrivateConversation}
          effectiveMode={effectiveMode}
          draft={draft}
          setDraft={setDraft}
          setComposerMode={setComposerMode}
          canSubmit={canSubmit}
          pendingInput={Boolean(room.pendingInput)}
          onSubmit={onSubmit}
        />
      )}
    </main>
  );
}

function PlayerTurnPanel({
  draft,
  setDraft,
  playerProposal,
  autoPlayer,
  onAutoPlayerChange,
  onSubmitPlayerPerformance,
  onSkip,
  pendingInput,
}: {
  draft: string;
  setDraft: (value: string) => void;
  playerProposal?: PlayerProposal;
  autoPlayer: boolean;
  onAutoPlayerChange: (enabled: boolean) => void;
  onSubmitPlayerPerformance: (performance: PlayerPerformance) => void;
  onSkip: () => void;
  pendingInput: boolean;
}) {
  return (
    <section className="world-player-turn" aria-label="当前玩家回合">
      <div className="world-player-turn-heading">
        <div>
          <span className="eyebrow">现在轮到你</span>
          <strong>{playerProposal?.prompt ?? "根据眼前的局面作出回应"}</strong>
        </div>
        <div className="world-player-turn-meta">
          <label className="world-player-auto">
            <input type="checkbox" checked={autoPlayer} onChange={(event) => onAutoPlayerChange(event.target.checked)} />
            <span>自动代演</span>
          </label>
          <small>{playerProposal ? (autoPlayer ? "已使用自动代演，将按当前身份继续。" : (playerProposal.guidance ?? "选择一种符合你身份的回应")) : "正在准备可选回应…"}</small>
        </div>
      </div>
      <div className="world-player-options">
        {(playerProposal?.suggestions ?? []).map((option, index) => (
          <button key={`${option.label}-${index}`} type="button" onClick={() => onSubmitPlayerPerformance(option.performance)} disabled={!playerProposal || pendingInput}>
            <span>{index + 1}</span><strong>{option.label}</strong><ChevronRight size={16} />
          </button>
        ))}
        {playerProposal && (
          <button type="button" className="is-skip" onClick={onSkip} disabled={pendingInput}>
            <span>—</span><strong>跳过这次回应</strong><ChevronRight size={16} />
          </button>
        )}
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        const message = draft.trim();
        if (!message || !playerProposal) return;
        setDraft("");
        onSubmitPlayerPerformance({ message });
      }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="按自己的方式回应…" disabled={!playerProposal || pendingInput} />
        <button className="button button-primary" type="submit" disabled={!playerProposal || !draft.trim() || pendingInput}>回应</button>
      </form>
    </section>
  );
}

function WorldComposer({
  isConversation,
  isPrivateConversation,
  effectiveMode,
  draft,
  setDraft,
  setComposerMode,
  canSubmit,
  pendingInput,
  onSubmit,
}: {
  isConversation: boolean;
  isPrivateConversation: boolean;
  effectiveMode: ComposerMode;
  draft: string;
  setDraft: (value: string) => void;
  setComposerMode: (mode: ComposerMode) => void;
  canSubmit: boolean;
  pendingInput: boolean;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <form
      className="world-composer"
      data-guide="world-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <div className="world-composer-heading">
        <label htmlFor="world-input">
          {effectiveMode === "directive" ? "用旁白改变当前局面" : isConversation ? "发消息，等角色回应" : "以你的身份进入当前场景"}
        </label>
        {!isConversation && <small>{effectiveMode === "directive" ? "发送旁白" : "正常发送"}</small>}
      </div>
      <div className="world-composer-input-row">
        <div className={`world-composer-input-shell${effectiveMode === "directive" ? " is-directive" : ""}`}>
          <input
            id="world-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={effectiveMode === "directive"
              ? "例如：暮色加深，远处传来不寻常的铃声"
              : "说点什么，角色会自行决定如何回应"}
            disabled={!canSubmit}
          />
          {!isConversation && (
            <button
              className="world-composer-mode-button"
              type="button"
              aria-label="切换发送类型"
              aria-pressed={effectiveMode === "directive"}
              title={effectiveMode === "directive" ? "切换为正常发送" : "切换为改变走向"}
              onClick={() => setComposerMode(effectiveMode === "directive" ? "message" : "directive")}
            >
              {effectiveMode === "directive" ? <WandSparkles size={15} /> : <MessageCircle size={15} />}
              <span>{effectiveMode === "directive" ? "改变走向" : "正常发送"}</span>
              <ChevronDown size={13} />
            </button>
          )}
        </div>
        <button className="button button-primary world-composer-submit" type="submit" disabled={!draft.trim() || !canSubmit}>
          {pendingInput ? <LoaderCircle className="is-spinning" size={16} /> : <Send size={16} />}
          {effectiveMode === "directive" ? "落笔" : "发送"}
        </button>
      </div>
      <div className="world-composer-suggestions" aria-label="快速开始">
        {(!isConversation && effectiveMode === "directive"
          ? ["让远处出现新的动静", "把时间推进到夜里", "让一个陌生人来到这里"]
          : ["我想问问孙悟空", "这里究竟发生了什么？", "我先在旁边观察"]).map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setDraft(suggestion)} disabled={!canSubmit}>
              {suggestion}
            </button>
        ))}
      </div>
      <small>
        {isConversation
          ? isPrivateConversation
            ? "这是独立私聊，不会启动或推进主世界。"
            : "这是独立 Harness 群聊，启动后角色会按 idle 自主参与。"
          : effectiveMode === "directive"
            ? "这段文字会作为旁白写入当前一幕，由角色和 Narrator 在原有剧情节点内承接。"
            : "你的话会成为这个世界的一部分，角色和环境会自行回应。"}
      </small>
    </form>
  );
}

export function WorldInspectorPanel({
  view,
  sceneActors,
  selectedActorId,
  setSelectedActorId,
  actorNotice,
  isConversation,
  room,
  onOpenCharacterLibrary,
  onFocusActor,
  onOpenPrivateChat,
}: {
  view: WorldView;
  sceneActors: WorldView["actors"];
  selectedActorId?: string;
  setSelectedActorId: Dispatch<SetStateAction<string | undefined>>;
  actorNotice?: string;
  isConversation: boolean;
  room: WorldRoomController;
  onOpenCharacterLibrary: () => void;
  onFocusActor: (actorName: string) => void;
  onOpenPrivateChat: (actorId: string) => void | Promise<void>;
}) {
  const selectedActor = sceneActors.find((actor) => actor.id === selectedActorId);
  return (
    <aside className="world-inspector" data-guide="world-inspector">
      <section className="inspector-section narrative-inspector">
        <div className="inspector-heading">
          <div>
            <p className="eyebrow">剧情图</p>
            <h2>剧情脉络</h2>
          </div>
          <GitBranch size={18} />
        </div>
        <NarrativeGraph view={view} />
      </section>

      <section className="inspector-section">
        <div className="inspector-heading">
          <div><p className="eyebrow">场内角色</p><h2>谁在这里</h2></div>
          <div className="inspector-heading-actions">
            <span className="count-mark">{sceneActors.length}</span>
            <button
              type="button"
              className="icon-button"
              title="从角色库邀请"
              aria-label="从角色库邀请角色"
              onClick={onOpenCharacterLibrary}
            >
              <UserPlus size={15} />
            </button>
          </div>
        </div>
        {actorNotice && <p className="world-actor-notice" role="status">{actorNotice}</p>}
        <div className="world-actor-list">
          {sceneActors.map((actor, index) => (
            <button
              className={`world-actor ${actor.id === selectedActorId ? "is-selected" : ""}`}
              key={actor.id}
              type="button"
              aria-pressed={actor.id === selectedActorId}
              onClick={() => setSelectedActorId(actor.id === selectedActorId ? undefined : actor.id)}
            >
              <span style={{ backgroundColor: actorColor(index, actor.playerControlled) }}>{actor.name.slice(0, 1)}</span>
              <div>
                <strong>{actor.name}</strong>
                <small>{actor.status || actor.description || availabilityLabel(actor.availability)}</small>
              </div>
            </button>
          ))}
        </div>
        {selectedActor && (
          <div className="world-actor-profile">
            <div className="world-actor-profile-heading">
              <div>
                <small>{selectedActor.playerControlled ? "玩家身份" : "角色身份"}</small>
                <strong>{selectedActor.name}</strong>
              </div>
              <span className={`actor-presence actor-presence-${selectedActor.presence ?? "offline"}`}>
                {presenceLabel(selectedActor.presence, selectedActor.availability)}
              </span>
            </div>
            <p>{selectedActor.description || "这位角色还没有公开简介。"}</p>
            {selectedActor.kind === "character" && (
              <div className="world-actor-profile-actions">
                <button className="button button-quiet" type="button" onClick={() => onFocusActor(selectedActor.name)}>
                  <MessageCircle size={14} />在这里回应
                </button>
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => void onOpenPrivateChat(selectedActor.id)}
                  disabled={room.pendingAction === "private_context"}
                >
                  {room.pendingAction === "private_context"
                    ? <LoaderCircle className="is-spinning" size={14} />
                    : <LockKeyhole size={14} />}
                  私聊
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {!isConversation && (
        <section className={`inspector-section director-note is-${view.director.status}`}>
          {view.director.status === "error" ? <AlertCircle size={16} /> : <WandSparkles size={16} />}
          <p><strong>{directorStatusTitle(view)}</strong>{directorStatusDetail(view)}</p>
        </section>
      )}
    </aside>
  );
}
