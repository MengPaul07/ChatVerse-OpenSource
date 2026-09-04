import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Gauge,
  LoaderCircle,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Send,
  WifiOff,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import MarkdownContent from "../components/MarkdownContent";
import type { WorldView } from "./types";
import type { WorldRoomController } from "./WorldRoomContext";
import { formatTime } from "./story-stream";
import { conversationRuntimeState } from "./conversationRuntime";

export function PresentationTransitionOverlay({ target }: { target: "world" | "stage" }) {
  return <div className="presentation-transition-overlay" role="status" aria-live="polite"><LoaderCircle className="is-spinning" size={20} /><div><strong>{target === "stage" ? "正在布置演出舞台" : "正在返回世界视图"}</strong><span>已暂停世界，正在稳定消息队列与阅读游标…</span></div></div>;
}

type WorldViewContext = WorldView["contexts"][number];

export function CommunicationDock({
  view,
  activeContextId,
  worldId,
  roomId,
  onOpen,
}: {
  view: WorldView;
  activeContextId?: string;
  worldId: string;
  roomId: string;
  onOpen: (contextId: string) => void;
}) {
  const conversations = view.contexts.filter((context) => Boolean(context.conversationMode));
  const [expanded, setExpanded] = useState(() => (
    typeof window === "undefined" || !window.matchMedia("(max-width: 680px)").matches
  ));
  if (conversations.length === 0) return null;
  return (
    <aside
      className={`world-communication-dock${expanded ? " is-open" : " is-collapsed"}`}
      aria-label="通讯空间"
    >
      <div className="world-communication-dock-head">
        <button
          className="world-communication-dock-toggle"
          type="button"
          aria-controls="world-communication-dock-list"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="world-communication-dock-label">
            <MessageCircle size={16} />
            <strong>通讯</strong>
            <small>{conversations.length} 个空间</small>
          </span>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <Link
          className="world-communication-dock-more"
          to={`/worlds/${encodeURIComponent(worldId)}?room=${encodeURIComponent(roomId)}`}
          title="打开世界菜单管理通讯"
          aria-label="管理通讯空间"
        >
          <ChevronRight size={15} />
        </Link>
      </div>
      {expanded && (
        <div className="world-communication-dock-list" id="world-communication-dock-list">
          {conversations.slice(-4).map((context) => {
            const latest = [...view.entries]
              .filter((entry) => entry.contextId === context.id)
              .sort((left, right) => right.occurredAt - left.occurredAt)[0];
            return (
              <button
                key={context.id}
                className={`world-communication-dock-item${context.id === activeContextId ? " is-active" : ""}`}
                type="button"
                title={`${context.name}${latest ? `：${latest.text}` : ""}`}
                aria-label={`打开${context.name}`}
                onClick={() => onOpen(context.id)}
              >
                <span className={`world-communication-avatar${context.conversationMode === "private" ? " is-private" : ""}`}>
                  {context.conversationMode === "private" ? "私" : context.name.slice(0, 1)}
                </span>
                <span className="world-communication-dock-copy">
                  <strong>{context.name}</strong>
                  <small>{latest?.text ?? (context.conversationMode === "private" ? "一对一通讯" : "群聊通讯")}</small>
                </span>
                {(context.unreadCount ?? 0) > 0 && (
                  <span className="world-communication-unread" aria-label={`${context.unreadCount} 条未读`}>
                    {Math.min(context.unreadCount ?? 0, 99)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

export function WorldCommunicationOverlay({
  view,
  room,
  context,
  worldContext,
  worldId,
  closePath,
  isPrivate,
}: {
  view: WorldView;
  room: WorldRoomController;
  context: WorldViewContext;
  worldContext?: WorldViewContext;
  worldId: string;
  closePath: string;
  isPrivate: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const messagesRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const conversations = view.contexts.filter((candidate) => Boolean(candidate.conversationMode));
  const runtime = conversationRuntimeState(isPrivate ? "private" : "group", context.status);
  const contextPaused = runtime.paused;
  const canSend = room.state.phase === "ready" && runtime.canSend;
  const entries = view.entries
    .filter((entry) => entry.contextId === context.id)
    .sort((left, right) => left.occurredAt - right.occurredAt);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") navigate(closePath);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePath, navigate]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function openConversation(contextId: string) {
    if (contextId === context.id) return;
    const next = new URLSearchParams();
    next.set("context", contextId);
    next.set("room", view.roomId);
    navigate(`/worlds/${encodeURIComponent(worldId)}?${next.toString()}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending || !canSend) return;
    setPending(true);
    const accepted = await room.sendMessage(message);
    if (accepted !== false) setDraft("");
    setPending(false);
  }

  return (
    <div className="world-communication-overlay page-enter">
      <Link className="world-communication-backdrop-close" to={closePath} aria-label="关闭聊天并回到世界" />
      <div
        className="world-communication-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-communication-title"
      >
        <aside className="world-communication-spaces" aria-label="通讯空间列表">
          <header>
            <span><MessageCircle size={16} /></span>
            <div><strong>通讯空间</strong><small>{view.world.name}</small></div>
          </header>
          <nav>
            {conversations.map((candidate) => {
              const latest = [...view.entries]
                .filter((entry) => entry.contextId === candidate.id)
                .sort((left, right) => right.occurredAt - left.occurredAt)[0];
              const privateConversation = candidate.conversationMode === "private";
              return (
                <button
                  className={`world-communication-space${candidate.id === context.id ? " is-active" : ""}${candidate.status === "paused" ? " is-paused" : ""}`}
                  key={candidate.id}
                  type="button"
                  onClick={() => openConversation(candidate.id)}
                  aria-current={candidate.id === context.id ? "page" : undefined}
                  aria-label={`打开${candidate.name}`}
                  title={candidate.name}
                >
                  <span className={`world-communication-avatar${privateConversation ? " is-private" : ""}`}>
                    {privateConversation ? "私" : candidate.name.slice(0, 1)}
                    {(candidate.unreadCount ?? 0) > 0 && (
                      <i className="world-communication-avatar-badge" aria-label={`${candidate.unreadCount} 条未读`}>
                        {Math.min(candidate.unreadCount ?? 0, 99)}
                      </i>
                    )}
                  </span>
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>{candidate.status === "paused"
                      ? "已暂停 · 不消耗 Token"
                      : candidate.status === "dormant" && !privateConversation
                        ? "等待开始"
                        : latest?.text ?? (privateConversation ? "一对一通讯" : `${candidate.actorIds.length} 位角色`)}</small>
                  </span>
                </button>
              );
            })}
          </nav>
          <Link to={closePath}><ArrowLeft size={15} /><span>返回世界</span></Link>
        </aside>
        <section className={`world-communication-panel${isPrivate ? " is-private" : ""}`}>
          <header className="world-communication-header">
            <Link className="world-communication-close" to={closePath} aria-label="回到现场" title="回到现场">
              <ArrowLeft size={18} />
            </Link>
            <span className={`world-communication-header-avatar${isPrivate ? " is-private" : ""}`}>
              {isPrivate ? "私" : context.name.slice(0, 1)}
            </span>
            <div>
              <strong id="world-communication-title">{context.name}</strong>
              <small>{isPrivate ? "世界里的私下通讯" : `${context.actorIds.length} 位角色 · 独立群聊`}</small>
            </div>
            {!isPrivate && (
              <button
                className={`world-communication-runtime${!runtime.active ? " is-paused" : ""}`}
                type="button"
                disabled={room.pendingAction === "context_pause" || room.pendingAction === "context_resume" || runtime.stopped}
                onClick={() => void (runtime.active ? room.pauseContext(context.id) : room.resumeContext(context.id))}
                aria-label={runtime.active ? `暂停${context.name}` : `${runtime.canStart ? "开始" : "继续"}${context.name}`}
                title={runtime.active ? "只暂停这个群聊，不影响世界" : "启动后，群聊角色会按 idle 节奏自主参与"}
              >
                {runtime.active ? <Pause size={13} /> : <Play size={13} />}
                <span>{runtime.active ? "暂停" : runtime.canStart ? "开始" : "继续"}</span>
              </button>
            )}
          </header>
          <div className={`world-communication-notice${!runtime.active && !isPrivate ? " is-paused" : ""}`}>
            {!runtime.active && !isPrivate ? <Pause size={14} /> : <MessageCircle size={14} />}
            <span>{context.pauseReason === "unread"
              ? "收到未读消息后已自动暂停，不会继续消耗 Token；阅读完后可手动继续。"
              : context.pauseReason === "unobserved"
                ? "长时间无人查看，已自动暂停以避免继续消耗 Token。"
                : contextPaused
                  ? "这个通讯空间已单独暂停，不影响世界和其他群聊。"
                  : runtime.canStart
                    ? "群聊尚未开始，启动后角色会按各自的 idle 节奏参与。"
                  : `来自${worldContext?.name ?? view.world.name}，这段通讯独立运行，不受世界暂停控制。`}</span>
          </div>
          <section className="world-communication-messages" aria-live="polite" ref={messagesRef}>
            {entries.length === 0 ? (
              <div className="world-communication-empty">
                <span>{isPrivate ? "私下说一句" : "把角色拉到这里"}</span>
                <p>{isPrivate ? "他们会以自己的身份回应你。" : "这段群聊会保留独立记录，并共享世界里已经发生的事。"}</p>
              </div>
            ) : entries.map((entry) => (
              <article className={`world-communication-message${entry.kind === "human" ? " is-human" : ""}`} key={entry.id}>
                {entry.kind === "narration" ? (
                  <MarkdownContent className="world-communication-narration" content={entry.text} />
                ) : (
                  <>
                    <span className="world-communication-message-avatar">{entry.kind === "human" ? "你" : (entry.actorName?.slice(0, 1) ?? "?")}</span>
                    <div>
                      <header><strong>{entry.kind === "human" ? "你" : entry.actorName ?? "未知角色"}</strong><time>{formatTime(entry.occurredAt)}</time></header>
                      <MarkdownContent className="world-communication-message-body" content={entry.text} />
                    </div>
                  </>
                )}
              </article>
            ))}
          </section>
          <form className="world-communication-composer" onSubmit={(event) => void submit(event)}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={contextPaused ? "先继续这个通讯空间再发送……" : runtime.canStart ? "先开始群聊再发送……" : isPrivate ? "只对这位角色说……" : "发到群里……"}
              disabled={pending || !canSend}
              aria-label={isPrivate ? "私聊消息" : "群聊消息"}
              autoFocus
            />
            <button className="button button-primary" type="submit" disabled={!draft.trim() || pending || !canSend} aria-label="发送">
              {pending ? <LoaderCircle className="is-spinning" size={16} /> : <Send size={16} />}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export function PacingControl({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => Promise<boolean>;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const [expanded, setExpanded] = useState(() => (
    typeof window === "undefined" || !window.matchMedia("(max-width: 680px)").matches
  ));
  const timerRef = useRef<number | undefined>(undefined);
  const latestValueRef = useRef(value);

  useEffect(() => {
    setDraftValue(value);
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  function scheduleCommit(next: number) {
    setDraftValue(next);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void onChange(next).then((accepted) => {
        if (accepted) latestValueRef.current = next;
        else setDraftValue(latestValueRef.current);
      });
    }, 220);
  }

  return (
    <section className={`world-pacing-dock${expanded ? " is-open" : " is-collapsed"}`} aria-label="世界节奏控制">
      <button
        className="world-pacing-toggle"
        type="button"
        aria-controls="world-pacing-controls"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="world-pacing-icon"><Gauge size={15} /></span>
        <span className="world-pacing-toggle-label">节奏</span>
        <ChevronDown size={14} />
      </button>
      <div className="world-pacing-body" id="world-pacing-controls">
        <div className="world-pacing-heading">
          <span className="world-pacing-icon"><Gauge size={15} /></span>
          <div>
            <strong>世界节奏</strong>
            <small>{pacingLabel(draftValue)} · 后续回应会按这个速度展开</small>
          </div>
        </div>
        <div className="world-pacing-slider">
          <span>快</span>
          <input
            type="range"
            min="0.5"
            max="2.5"
            step="0.05"
            value={draftValue}
            disabled={disabled}
            aria-label="世界节奏快慢"
            aria-valuetext={pacingLabel(draftValue)}
            onChange={(event) => scheduleCommit(Number(event.target.value))}
          />
          <span>慢</span>
        </div>
      </div>
    </section>
  );
}

function pacingLabel(value: number): string {
  if (value < 0.9) return "快速";
  if (value < 1.15) return "标准";
  if (value < 1.55) return "慢一些";
  if (value < 2) return "舒缓";
  return "很慢";
}

export function saveButtonTitle(saveState: {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt?: number;
  error?: string;
}): string {
  if (saveState.status === "saving") return "正在保存世界";
  if (saveState.status === "error") return saveState.error ?? "世界保存失败";
  if (saveState.status === "saved" && saveState.lastSavedAt) {
    return `已保存于 ${new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(saveState.lastSavedAt)}`;
  }
  return "保存世界";
}

export function ConnectionStatus({
  view,
  connection,
}: {
  view: WorldView;
  connection: "connecting" | "open" | "reconnecting" | "closed";
}) {
  if (connection !== "open") {
    return <span className="world-status is-warning"><WifiOff size={13} />{connection === "reconnecting" ? "正在重连" : "正在连接"}</span>;
  }
  return <span className={`world-status is-${view.director.status}`}><i />{directorStatusTitle(view)}</span>;
}

export function WorldUnavailable({
  message,
  onRetry,
  onReset,
  resetLabel,
}: {
  message: string;
  onRetry: () => void | Promise<unknown>;
  onReset: () => void | Promise<unknown>;
  resetLabel: string;
}) {
  return (
    <div className="world-system-screen is-error">
      <AlertCircle size={28} />
      <h1>世界暂时无法启动</h1>
      <p>{message}</p>
      <div className="world-system-actions">
        <button className="button button-primary" onClick={() => void onRetry()}>
          <RefreshCw size={16} />再试一次
        </button>
        <button className="button button-quiet" onClick={() => void onReset()}>
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

export function directorStatusTitle(view: WorldView): string {
  if (view.world.status === "idle") return "等待开始";
  if (view.world.status === "stopped") return "世界已停止";
  if (view.world.status === "paused") return "世界已暂停";
  switch (view.director.status) {
    case "running": return "世界正在回应";
    case "scheduled": return "世界即将变化";
    case "error": return "世界暂时安静";
    default: return "世界在线";
  }
}

export function directorStatusDetail(view: WorldView): string {
  if (view.world.status === "idle") return " 点击开始，让第一幕出现。";
  switch (view.director.status) {
    case "running": return " 正在观察眼前发生的一切。";
    case "scheduled": return " 已听见你的请求，新的变化很快会出现。";
    case "error": return ` ${view.director.error ?? "稍后会继续尝试。"} `;
    default: return " 角色会按自己的心意行动，故事不会被固定写死。";
  }
}

export function contextStatusLabel(status: WorldView["contexts"][number]["status"] | undefined): string {
  switch (status) {
    case "active": return "正在发生";
    case "dormant": return "安静";
    case "paused": return "暂停";
    case "stopped": return "停止";
    default: return "未连接";
  }
}

export function availabilityLabel(value: WorldView["actors"][number]["availability"]): string {
  return value === "available" ? "在场" : value === "away" ? "暂未现身" : "不可用";
}

export function presenceLabel(
  presence: WorldView["actors"][number]["presence"] | undefined,
  availability: WorldView["actors"][number]["availability"],
): string {
  if (presence === "online") return "此刻在场";
  if (presence === "away") return "暂时离开";
  if (presence === "offline") return "暂未出现";
  return availabilityLabel(availability);
}

export function actorColor(index: number, playerControlled: boolean): string {
  if (playerControlled) return "#5f766d";
  return ["#a65543", "#487469", "#8b6d9a", "#8a6c3c"][index % 4]!;
}
