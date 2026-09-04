import {
  Activity,
  ArrowLeft,
  Bug,
  ChevronRight,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageCircle,
  Plus,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { GroupCard } from "@chatverse/core";
import { getLibraryGroup } from "../groupLibrary";
import {
  groupWorldRoomStorageKey,
  worldArchiveRoomStorageKey,
  worldRoomStorageKey,
} from "../worldStorageKeys";
import { useWorldRoomContext } from "../world/WorldRoomContext";
import { WorldRoomProvider } from "../world/WorldRoomProvider";
import type { UseWorldRoomOptions } from "../world/useWorldRoom";
import "../world/communication.css";

export default function WorldShell() {
  const { worldId } = useParams();
  const [searchParams] = useSearchParams();
  const groupId = searchParams.get("groupId") || undefined;
  const archiveLibraryId = searchParams.get("archive") || undefined;
  const initialRoomId = searchParams.get("room") || undefined;
  const [groupSource, setGroupSource] = useState<GroupSourceState>(() => (
    groupId ? { groupId, status: "loading" } : { status: "ready" }
  ));

  useEffect(() => {
    let cancelled = false;
    if (!groupId) {
      setGroupSource({ status: "ready" });
      return () => { cancelled = true; };
    }
    setGroupSource({ groupId, status: "loading" });
    void getLibraryGroup(groupId).then((record) => {
      if (cancelled) return;
      if (!record) {
        setGroupSource({ groupId, status: "error", error: "找不到这个群聊配置，它可能已经被删除。" });
        return;
      }
      setGroupSource({ groupId, status: "ready", group: record.group });
    }).catch((cause) => {
      if (cancelled) return;
      setGroupSource({
        groupId,
        status: "error",
        error: cause instanceof Error ? cause.message : "无法读取群聊配置。",
      });
    });
    return () => { cancelled = true; };
  }, [groupId]);

  if (!worldId) {
    return <WorldShellState title="无法打开世界" detail="世界地址缺少必要标识。" />;
  }

  if (groupId && (groupSource.groupId !== groupId || groupSource.status === "loading")) {
    return <WorldShellState title="正在打开世界" detail="正在读取这个世界所属的本地配置。" />;
  }
  if (groupId && groupSource.status === "error") {
    return <WorldShellState title="无法打开群聊" detail={groupSource.error ?? "群聊配置不可用。"} />;
  }

  const sourceGroup = groupId ? groupSource.group : undefined;
  const options: UseWorldRoomOptions = {
    worldId,
    contextId: searchParams.get("context") || undefined,
    initialRoomId,
    group: sourceGroup,
    autoCreate: Boolean(sourceGroup),
    archiveLibraryId,
    storageKey: archiveLibraryId
      ? worldArchiveRoomStorageKey(archiveLibraryId)
      : groupId
        ? groupWorldRoomStorageKey(groupId)
        : worldRoomStorageKey(worldId),
  };

  return (
    <WorldRoomProvider options={options}>
      <WorldShellContent
        worldId={worldId}
      />
    </WorldRoomProvider>
  );
}

function WorldShellContent({
  worldId,
}: {
  worldId: string;
}) {
  const location = useLocation();
  const room = useWorldRoomContext();
  const view = room.state.view;
  const [worldMenuOpen, setWorldMenuOpen] = useState(false);

  useEffect(() => {
    setWorldMenuOpen(false);
  }, [location.pathname]);

  if (room.state.phase === "loading") {
    return <WorldShellState title="正在连接世界" detail="聊天空间和世界状态马上就会出现。" />;
  }

  if (room.state.phase === "error" || !view) {
    return (
      <WorldShellState
        title="世界暂时不可用"
        detail={room.state.error ?? "没有读到这个世界的运行状态。"}
        action={<button className="button button-primary" onClick={() => void room.retry()}>重新连接</button>}
      />
    );
  }

  if (location.pathname.endsWith("/play")) return <Outlet />;

  const worldBase = `/worlds/${encodeURIComponent(worldId)}`;
  const isLiveWorld = isWorldRoot(location.pathname, worldBase);

  return (
    <div className={`world-shell page-enter${isLiveWorld ? " is-live-world" : ""}`}>
      <WorldSidebar
        worldId={worldId}
        view={view}
        location={location.pathname + location.search}
        mobileMenuOpen={worldMenuOpen}
        onToggle={() => setWorldMenuOpen((open) => !open)}
        onClose={() => setWorldMenuOpen(false)}
      />
      <main className="world-shell-main">
        <Outlet />
      </main>
    </div>
  );
}

interface GroupSourceState {
  groupId?: string;
  status: "loading" | "ready" | "error";
  group?: GroupCard;
  error?: string;
}

function WorldSidebar({
  worldId,
  view,
  location,
  mobileMenuOpen,
  onToggle,
  onClose,
}: {
  worldId: string;
  view: NonNullable<ReturnType<typeof useWorldRoomContext>["state"]["view"]>;
  location: string;
  mobileMenuOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const room = useWorldRoomContext();
  const [creatorOpen, setCreatorOpen] = useState(false);
  const contextId = searchParams.get("context") || view.contexts[0]?.id;
  const base = `/worlds/${encodeURIComponent(worldId)}`;
  const withQuery = (path: string, extra?: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(extra ?? {}).forEach(([key, value]) => next.set(key, value));
    const nextQuery = next.toString();
    return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
  };
  const currentContext = view.contexts.find((context) => context.id === contextId);

  return (
    <aside
      id="world-navigation"
      data-guide="world-navigation"
      className={`world-sidebar${mobileMenuOpen ? " is-mobile-open" : ""}`}
      aria-label={`${view.world.name} 世界导航`}
    >
      <div className="world-sidebar-head">
        <Link className="world-sidebar-back" to="/groups" title="回到世界库" aria-label="回到世界库">
          <ArrowLeft size={15} />
        </Link>
        <div className="world-sidebar-mark">{view.world.name.slice(0, 1)}</div>
        <div className="world-sidebar-identity">
          <strong>{view.world.name}</strong>
          <span>{view.actors.length} 位角色 · {view.contexts.length} 个空间</span>
        </div>
        <button
          className="icon-button world-sidebar-menu"
          type="button"
          aria-label={mobileMenuOpen ? "收起世界导航" : "展开世界导航"}
          aria-expanded={mobileMenuOpen}
          onClick={onToggle}
        >
          {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>

      <div className="world-sidebar-pulse">
        <span className={`world-sidebar-pulse-dot is-${view.world.status}`} />
        <span>{worldStatusLabel(view.world.status)}</span>
        <span className="world-sidebar-pulse-time">{formatWorldTime(view.world.worldTime)}</span>
      </div>

      <nav className="world-sidebar-nav" aria-label="世界视图">
        <WorldSidebarLink to={withQuery(base)} icon={MessageCircle} label="现场" active={isWorldRoot(location, base)} onNavigate={onClose} />
        <WorldSidebarLink to={withQuery(`${base}/tasks`)} icon={LayoutDashboard} label="任务" active={location.includes("/tasks")} onNavigate={onClose} />
        <WorldSidebarLink to={withQuery(`${base}/story`)} icon={GitBranch} label="剧情" active={location.includes("/story")} onNavigate={onClose} />
        <WorldSidebarLink to={withQuery(`${base}/manage/actors`)} icon={Users} label="角色与关系" active={location.includes("/manage/actors")} onNavigate={onClose} />
      </nav>

      <div className="world-sidebar-section-head">
        <span>通讯空间</span>
        <button className="icon-button world-sidebar-add" title="新建聊天空间" aria-label="新建聊天空间" type="button" onClick={() => setCreatorOpen(true)}>
          <Plus size={15} />
        </button>
      </div>
      <nav className="world-context-list" aria-label="聊天空间">
        {view.contexts.map((context) => (
          <Link
            key={context.id}
            className={`world-context-link${context.id === contextId ? " is-active" : ""}`}
            to={withQuery(base, { context: context.id })}
            onClick={onClose}
          >
            <span className={`world-context-icon${context.conversationMode === "private" ? " is-private" : ""}`}>
              {context.conversationMode === "private" ? "私" : context.name.slice(0, 1)}
            </span>
            <span className="world-context-copy">
              <strong>{context.name}</strong>
              <small>{context.status === "paused" ? "已暂停 · 不消耗 Token" : contextLabel(context, view)} · {context.actorIds.length} 人</small>
            </span>
            {(context.unreadCount ?? 0) > 0
              ? <span className="world-context-unread" aria-label={`${context.unreadCount} 条未读`}>{Math.min(context.unreadCount ?? 0, 99)}</span>
              : context.id === contextId && <ChevronRight size={14} />}
          </Link>
        ))}
      </nav>

      <div className="world-sidebar-current">
        <span className="eyebrow">当前现场</span>
        <strong>{currentContext?.name ?? "尚未选择空间"}</strong>
        <span>{currentContext?.scene.text ?? "选择一个聊天空间开始。"}</span>
      </div>

      <div className="world-sidebar-footer">
        <Link className="world-sidebar-footer-link" to={withQuery(`${base}/manage`)} onClick={onClose}>
          <Settings2 size={15} />
          <span>管理世界</span>
        </Link>
        <Link className="world-sidebar-footer-link" to={withQuery(`${base}/debug`)} onClick={onClose}>
          <Bug size={15} />
          <span>调试观察</span>
        </Link>
        <Link className="world-sidebar-showcase" to="/showcase" onClick={onClose}>
          <Activity size={14} />
          <span>编排演示</span>
        </Link>
      </div>

      {creatorOpen && (
        <ConversationCreator
          actors={view.actors.filter((actor) => !actor.playerControlled)}
          pending={room.pendingAction === "context_create"}
          onClose={() => setCreatorOpen(false)}
          onCreate={async (mode, actorIds, name, topic) => {
            const created = await room.createContext({
              conversationMode: mode,
              actorIds,
              name,
              topic,
            });
            if (!created) return;
            const next = new URLSearchParams(searchParams);
            next.set("context", created);
            next.set("room", view.roomId);
            setCreatorOpen(false);
            navigate(`${base}?${next.toString()}`);
          }}
        />
      )}
    </aside>
  );
}

function ConversationCreator({
  actors,
  pending,
  onClose,
  onCreate,
}: {
  actors: Array<{
    id: string;
    name: string;
    description?: string;
    presence?: "online" | "away" | "offline";
  }>;
  pending: boolean;
  onClose: () => void;
  onCreate: (mode: "private" | "group", actorIds: string[], name?: string, topic?: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"private" | "group">("private");
  const [selected, setSelected] = useState<string[]>(actors[0] ? [actors[0].id] : []);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");

  function chooseActor(actorId: string) {
    if (mode === "private") {
      setSelected([actorId]);
      return;
    }
    setSelected((current) => current.includes(actorId)
      ? current.filter((id) => id !== actorId)
      : [...current, actorId]);
  }

  function changeMode(nextMode: "private" | "group") {
    setMode(nextMode);
    if (nextMode === "private") setSelected((current) => current.slice(0, 1));
  }

  const valid = mode === "private" ? selected.length === 1 : selected.length >= 2;
  return createPortal(
    <div className="world-conversation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="world-conversation-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-creator-title">
        <header>
          <div><p className="eyebrow">新的通讯空间</p><h2 id="conversation-creator-title">开始一段对话</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="world-conversation-mode" role="tablist" aria-label="对话类型">
          <button type="button" className={mode === "private" ? "is-active" : ""} onClick={() => changeMode("private")}>私聊</button>
          <button type="button" className={mode === "group" ? "is-active" : ""} onClick={() => changeMode("group")}>群聊</button>
        </div>
        <div className="world-conversation-copy">
          <strong>{mode === "private" ? "只邀请一位角色" : "把几位角色拉进一个新的现场"}</strong>
          <span>{mode === "private" ? "世界记忆仍然共享，但这段聊天不会出现在原群里。" : "新群保留世界级 Actor 状态，拥有独立的聊天记录。"}</span>
        </div>
        <div className="world-conversation-actors">
          {actors.map((actor) => (
            <button type="button" key={actor.id} className={`world-conversation-actor${selected.includes(actor.id) ? " is-selected" : ""}`} onClick={() => chooseActor(actor.id)}>
              <span className="world-conversation-avatar">{actor.name.slice(0, 1)}</span>
              <span><strong>{actor.name}</strong><small>{actor.description || (actor.presence === "offline" ? "暂时离线" : "可以回应")}</small></span>
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
        {mode === "group" && <div className="world-conversation-fields"><label><span>群名（可选）</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：山下碰头" /></label><label><span>这次聊什么（可选）</span><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：一起商量下一步" /></label></div>}
        <footer><span>{mode === "private" ? "选择 1 位角色" : `已选择 ${selected.length} 位角色`}</span><button className="button button-primary" type="button" disabled={!valid || pending} onClick={() => void onCreate(mode, selected, name, topic)}>{pending ? "正在打开…" : mode === "private" ? "打开私聊" : "创建群聊"}</button></footer>
      </section>
    </div>,
    document.body,
  );
}

function WorldSidebarLink({
  to,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  to: string;
  icon: typeof MessageCircle;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink className={`world-sidebar-nav-link${active ? " is-active" : ""}`} to={to} onClick={onNavigate}>
      <Icon size={16} />
      <span>{label}</span>
    </NavLink>
  );
}

function WorldShellState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="world-shell-state">
      <LoaderCircle className="is-spinning" size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
      {action}
    </div>
  );
}

function isWorldRoot(pathname: string, base: string): boolean {
  const pathOnly = pathname.split("?", 1)[0];
  return pathOnly === base || pathOnly === `${base}/`;
}

function worldStatusLabel(status: string): string {
  return status === "running" ? "世界运行中" : status === "paused" ? "已暂停" : status === "stopped" ? "已停止" : "等待开始";
}

function formatWorldTime(value: number): string {
  if (!Number.isFinite(value)) return "未定时";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(value);
}

function contextLabel(
  context: NonNullable<ReturnType<typeof useWorldRoomContext>["state"]["view"]>["contexts"][number],
  view: NonNullable<ReturnType<typeof useWorldRoomContext>["state"]["view"]>,
): string {
  if (context.conversationMode === "private") return "私聊";
  return context.id === view.contexts[0]?.id ? "世界" : "群聊";
}
