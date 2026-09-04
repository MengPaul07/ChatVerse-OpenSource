import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BrainCircuit,
  Braces,
  Download,
  Bug,
  GitBranch,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  ServerCog,
  RadioTower,
  X,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  WorldDebugCategory,
  WorldDebugEvent,
  WorldDebugSnapshot,
} from "@chatverse/core";
import { useWorldDebug } from "./useWorldDebug";
import {
  categoryLabel,
  contextEventCount,
  findMemoryNode,
} from "./world-debug-formatters";
import {
  EventInspector,
  MemoryInspector,
  MemoryPanel,
  NarrativePanel,
  RawSnapshot,
  RuntimePanel,
  Timeline,
} from "./world-debug-panels";
import { ProviderSessionLog } from "./ProviderSessionLog";

type DebugTab = "timeline" | "provider" | "runtime" | "memory" | "narrative" | "raw";

const TABS: Array<{ id: DebugTab; label: string; icon: typeof Activity }> = [
  { id: "timeline", label: "时间轴", icon: Activity },
  { id: "provider", label: "Session Log", icon: RadioTower },
  { id: "runtime", label: "运行态", icon: ServerCog },
  { id: "memory", label: "记忆", icon: BrainCircuit },
  { id: "narrative", label: "剧情", icon: GitBranch },
  { id: "raw", label: "快照", icon: Braces },
];

const CATEGORIES: WorldDebugCategory[] = [
  "world",
  "director",
  "context",
  "harness",
  "queue",
  "memory",
  "provider",
  "error",
];

export default function WorldDebugPage() {
  const { worldId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const archiveLibraryId = searchParams.get("archive") || undefined;
  const initialRoomId = searchParams.get("room") || undefined;
  const worldPath = `/worlds/${encodeURIComponent(worldId)}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const debug = useWorldDebug({ worldId, archiveLibraryId, initialRoomId });
  const [tab, setTab] = useState<DebugTab>("timeline");
  const [category, setCategory] = useState<WorldDebugCategory>();
  const [contextId, setContextId] = useState<string>();
  const [actorId, setActorId] = useState<string>();
  const [search, setSearch] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [selectedMemoryId, setSelectedMemoryId] = useState<string>();
  const [frozen, setFrozen] = useState(false);
  const [frozenAtCount, setFrozenAtCount] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const snapshot = debug.state.view?.snapshot;

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return debug.state.events.filter((event) => {
      if (category && event.category !== category) return false;
      if (contextId && event.contextId !== contextId) return false;
      if (actorId && event.actorId !== actorId) return false;
      if (!query) return true;
      return `${event.type} ${JSON.stringify(event.payload)}`.toLocaleLowerCase().includes(query);
    });
  }, [actorId, category, contextId, debug.state.events, search]);

  const selectedEvent = filteredEvents.find((event) => event.id === selectedEventId)
    ?? filteredEvents[filteredEvents.length - 1];

  useEffect(() => {
    if (tab !== "timeline" || frozen) return;
    const container = timelineRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [filteredEvents.length, frozen, tab]);

  if (debug.state.phase === "loading") {
    return <DebugSystemState worldPath={worldPath} icon={<LoaderCircle className="is-spinning" />} title="正在连接诊断通道" />;
  }
  if (debug.state.phase === "disabled") {
    return (
      <DebugSystemState
        icon={<Bug />}
        title="服务端未开启 Debug"
        detail="公开运行默认关闭 Debug；开发时请设置 CHATVERSE_DEBUG=true 后重启 World Server。"
        worldPath={worldPath}
      />
    );
  }
  if (debug.state.phase === "error" || !snapshot) {
    return (
      <DebugSystemState
        icon={<AlertCircle />}
        title="无法读取诊断状态"
        detail={debug.state.error}
        action={<button className="button button-primary" onClick={debug.refresh}><RefreshCw size={15} />重试</button>}
        worldPath={worldPath}
      />
    );
  }

  const selectedMemory = findMemoryNode(snapshot, selectedMemoryId);
  const newWhileFrozen = frozen ? Math.max(0, debug.state.events.length - frozenAtCount) : 0;

  function toggleFrozen() {
    setFrozen((current) => {
      if (!current) setFrozenAtCount(debug.state.events.length);
      return !current;
    });
  }

  return (
    <div className="debug-page">
      <header className="debug-header">
        <div className="debug-title">
          <Link to={worldPath} className="icon-button" title="返回世界" aria-label="返回世界">
            <ArrowLeft size={17} />
          </Link>
          <span className="debug-mark"><Bug size={17} /></span>
          <div>
            <strong>World Observatory</strong>
            <span>{snapshot.world.id}</span>
          </div>
        </div>
        <div className="debug-health-strip">
          <StatusCell label="World" value={snapshot.world.status} tone={snapshot.world.status === "running" ? "ok" : "warn"} />
          <StatusCell label="SSE" value={debug.state.connection} tone={debug.state.connection === "open" ? "ok" : "warn"} />
          <StatusCell label="Director" value={snapshot.director.running ? "running" : snapshot.director.dueAt ? "scheduled" : "idle"} tone={snapshot.director.running ? "active" : "neutral"} />
          <StatusCell label="Pending" value={String(snapshot.director.pendingEvents)} tone={snapshot.director.pendingEvents ? "warn" : "neutral"} />
          <StatusCell label="Trace" value={`#${snapshot.lastDebugSequence}`} tone="neutral" />
        </div>
        <div className="debug-header-actions">
          <button className="icon-button" onClick={toggleFrozen} title={frozen ? "继续跟随" : "冻结视图"}>
            {frozen ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button className="icon-button" onClick={() => exportTrace(snapshot, debug.state.events)} title="导出 Trace">
            <Download size={16} />
          </button>
          <button className="icon-button" onClick={debug.refresh} title="刷新快照">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <nav className="debug-tabs" aria-label="诊断视图">
        {TABS.map((item) => (
          <button key={item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
            <item.icon size={15} />{item.label}
          </button>
        ))}
      </nav>

      <div className="debug-workbench">
        <aside className="debug-filter-rail">
          <label className="debug-search">
            <Search size={14} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="过滤事件" />
            {search && <button onClick={() => setSearch("")} title="清除"><X size={13} /></button>}
          </label>
          <FilterSection title="类别">
            <FilterButton active={!category} label="全部事件" count={debug.state.events.length} onClick={() => setCategory(undefined)} />
            {CATEGORIES.map((item) => (
              <FilterButton
                key={item}
                active={category === item}
                label={categoryLabel(item)}
                count={debug.state.events.filter((event) => event.category === item).length}
                tone={item}
                onClick={() => setCategory(category === item ? undefined : item)}
              />
            ))}
          </FilterSection>
          <FilterSection title="Context">
            <FilterButton active={!contextId} label="全部 Context" onClick={() => setContextId(undefined)} />
            {snapshot.contexts.map((context) => (
              <FilterButton
                key={context.contextId}
                active={contextId === context.contextId}
                label={context.name}
                count={contextEventCount(debug.state.events, context.contextId)}
                onClick={() => setContextId(contextId === context.contextId ? undefined : context.contextId)}
              />
            ))}
          </FilterSection>
          <FilterSection title="Actor">
            {snapshot.actors.map(({ state }) => (
              <FilterButton
                key={state.actorId}
                active={actorId === state.actorId}
                label={state.actorId}
                count={debug.state.events.filter((event) => event.actorId === state.actorId).length}
                onClick={() => setActorId(actorId === state.actorId ? undefined : state.actorId)}
              />
            ))}
          </FilterSection>
        </aside>

        <main className="debug-main-panel">
          {tab === "timeline" && (
            <Timeline
              events={filteredEvents}
              selectedId={selectedEvent?.id}
              onSelect={setSelectedEventId}
              containerRef={timelineRef}
              frozenCount={newWhileFrozen}
              onResume={toggleFrozen}
            />
          )}
          {tab === "runtime" && (
            <RuntimePanel
              snapshot={snapshot}
              actors={debug.state.view?.actors ?? []}
              mutateActor={debug.mutateActor}
              mutation={debug.mutation}
            />
          )}
          {tab === "provider" && <ProviderSessionLog events={debug.state.events} />}
          {tab === "memory" && (
            <MemoryPanel
              snapshot={snapshot}
              selectedId={selectedMemory?.id}
              onSelect={setSelectedMemoryId}
            />
          )}
          {tab === "narrative" && <NarrativePanel snapshot={snapshot} />}
          {tab === "raw" && <RawSnapshot snapshot={snapshot} />}
        </main>

        <aside className="debug-inspector">
          {tab === "provider"
            ? <ProviderLogSummary events={debug.state.events} />
            : tab === "memory"
            ? <MemoryInspector node={selectedMemory} snapshot={snapshot} />
            : <EventInspector event={selectedEvent} />}
        </aside>
      </div>
    </div>
  );
}

function ProviderLogSummary({ events }: { events: readonly WorldDebugEvent[] }) {
  const providerEvents = events.filter((event) => event.type.startsWith("provider.session_"));
  const requests = providerEvents.filter((event) => event.type === "provider.session_request").length;
  const errors = providerEvents.filter((event) => event.type === "provider.session_error").length;
  return (
    <section className="debug-inspector-section">
      <h2>Provider Session Log</h2>
      <p>只展示实际经过 Provider 的请求。输入、完整响应、工具调用和错误均按 requestId 配对。</p>
      <div className="debug-inspector-row"><span>请求</span><code>{requests}</code></div>
      <div className="debug-inspector-row"><span>失败</span><code>{errors}</code></div>
      <p>日志仅在 Debug 开启时保留于当前有界事件窗口，不包含 API Key。</p>
    </section>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="debug-filter-section"><h2>{title}</h2>{children}</section>;
}

function FilterButton({
  active,
  label,
  count,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "is-active" : ""} onClick={onClick}>
      {tone && <i className={`is-${tone}`} />}
      <span>{label}</span>
      {count != null && <small>{count}</small>}
    </button>
  );
}

function StatusCell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`debug-status-cell is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function DebugSystemState({
  icon,
  title,
  detail,
  action,
  worldPath = "/groups",
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
  worldPath?: string;
}) {
  return <div className="debug-system-state">{icon}<h1>{title}</h1>{detail && <p>{detail}</p>}{action}<Link to={worldPath}>返回世界</Link></div>;
}

function exportTrace(snapshot: WorldDebugSnapshot, events: WorldDebugEvent[]): void {
  const blob = new Blob([JSON.stringify({ snapshot, events }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `chatverse-trace-${snapshot.world.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
