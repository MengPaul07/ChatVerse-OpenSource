import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Background,
  Controls,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  AlertCircle,
  BrainCircuit,
  Bot,
  Copy,
  Gauge,
  GitBranch,
  MemoryStick,
  Radio,
  Save,
  ServerCog,
  Users,
} from "lucide-react";
import type {
  ActorMemoryNode,
  WorldDebugEvent,
  WorldDebugSnapshot,
} from "@chatverse/core";
import type { WorldView } from "../world/types";
import {
  buildMemoryGraph,
  categoryLabel,
  durationValue,
  eventSummary,
  formatTime,
  formatTokenCount,
  relativeTime,
  runtimeMetrics,
  sessionView,
} from "./world-debug-formatters";

export function Timeline({
  events,
  selectedId,
  onSelect,
  containerRef,
  frozenCount,
  onResume,
}: {
  events: WorldDebugEvent[];
  selectedId?: string;
  onSelect: (id: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  frozenCount: number;
  onResume: () => void;
}) {
  return (
    <section className="debug-timeline">
      <header className="debug-panel-heading">
        <div><strong>统一因果时间轴</strong><span>{events.length} events</span></div>
        {frozenCount > 0 && <button onClick={onResume}>{frozenCount} 条新事件</button>}
      </header>
      <div className="debug-event-list" ref={containerRef}>
        {events.map((event) => (
          <button
            key={event.id}
            className={`debug-event-row is-${event.category}${selectedId === event.id ? " is-selected" : ""}`}
            onClick={() => onSelect(event.id)}
          >
            <span className="debug-sequence">#{event.sequence}</span>
            <time>{formatTime(event.occurredAt)}</time>
            <span className="debug-event-lane">{categoryLabel(event.category)}</span>
            <span className="debug-event-summary">{eventSummary(event)}</span>
            {event.actorId && <span className="debug-event-chip">{event.actorId}</span>}
            {durationValue(event) != null && <span className="debug-duration">{durationValue(event)}ms</span>}
          </button>
        ))}
        {events.length === 0 && <PanelEmpty icon={<Radio />} text="暂无匹配事件" />}
      </div>
    </section>
  );
}

export function RuntimePanel({
  snapshot,
  actors,
  mutateActor,
  mutation,
}: {
  snapshot: WorldDebugSnapshot;
  actors: WorldView["actors"];
  mutateActor: (
    actorId: string,
    action: "presence" | "participation" | "control",
    body?: Record<string, unknown>,
  ) => Promise<void>;
  mutation: { key?: string; error?: string };
}) {
  const metrics = runtimeMetrics(snapshot.events);
  return (
    <div className="debug-scroll-panel">
      <section className="runtime-director">
        <div className="debug-section-title"><Bot size={16} /><strong>World Director</strong></div>
        <div className="runtime-line-grid">
          <RuntimeDatum label="状态" value={snapshot.director.running ? "running" : snapshot.director.dueAt ? "scheduled" : "idle"} />
          <RuntimeDatum label="Cursor" value={String(snapshot.director.cursor)} />
          <RuntimeDatum label="Pending" value={String(snapshot.director.pendingEvents)} />
          <RuntimeDatum label="Retry" value={String(snapshot.director.retryIndex)} />
          <RuntimeDatum label="Next run" value={snapshot.director.dueAt ? relativeTime(snapshot.director.dueAt) : "—"} />
          <RuntimeDatum label="Last run" value={snapshot.director.lastRunAt ? formatTime(snapshot.director.lastRunAt) : "—"} />
        </div>
        {snapshot.director.plan ? (
          <div className="runtime-task-summary">
            <RuntimeDatum label="Plan" value={snapshot.director.plan.id} />
            <RuntimeDatum label="Requests" value={String(snapshot.director.plan.modelRequestCount)} />
            <RuntimeDatum label="Reason" value={snapshot.director.plan.reasons.join(", ")} />
          </div>
        ) : null}
        {snapshot.director.task ? (
          <div className="runtime-task-summary">
            <RuntimeDatum label="Mode" value={snapshot.director.task.mode ?? "plan_beat"} />
            <RuntimeDatum label="Task" value={snapshot.director.task.status} />
            <RuntimeDatum label="Tools" value={snapshot.director.task.toolNames.join(", ") || "—"} />
            <RuntimeDatum label="Retry" value={String(snapshot.director.task.retryCount)} />
            <RuntimeDatum
              label="Goal"
              value={snapshot.director.task.objective.length > 140
                ? `${snapshot.director.task.objective.slice(0, 139)}…`
                : snapshot.director.task.objective}
            />
            {snapshot.director.task.missingToolNames.length > 0 ? (
              <RuntimeDatum label="Missing" value={snapshot.director.task.missingToolNames.join(", ")} />
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="runtime-context runtime-metrics">
        <div className="debug-section-title"><Gauge size={16} /><strong>Token lifetime</strong><span>不受事件窗口裁剪影响</span></div>
        <div className="runtime-line-grid">
          <RuntimeDatum label="LLM calls" value={String(snapshot.tokenUsage.requestCount)} />
          <RuntimeDatum label="Input tokens" value={formatTokenCount(snapshot.tokenUsage.inputTokens)} />
          <RuntimeDatum label="Output tokens" value={formatTokenCount(snapshot.tokenUsage.outputTokens)} />
          <RuntimeDatum label="Total tokens" value={formatTokenCount(snapshot.tokenUsage.totalTokens)} />
          <RuntimeDatum label="Cache hit" value={formatTokenCount(snapshot.tokenUsage.cacheHitInputTokens)} />
          <RuntimeDatum label="Reasoning" value={formatTokenCount(snapshot.tokenUsage.reasoningTokens)} />
        </div>
      </section>
      <section className="runtime-context runtime-metrics">
        <div className="debug-section-title">
          <Activity size={16} />
          <strong>Trace window</strong>
          <span>
            保留 {snapshot.events.length} 条
            {snapshot.droppedDebugEventCount > 0
              ? ` · 已裁剪 ${snapshot.droppedDebugEventCount} 条`
              : ""}
          </span>
        </div>
        <div className="runtime-line-grid">
          <RuntimeDatum label="Speak" value={String(metrics.speak)} />
          <RuntimeDatum label="Silent" value={String(metrics.silent)} />
          <RuntimeDatum label="Committed" value={String(metrics.committed)} />
          <RuntimeDatum label="Dropped" value={String(metrics.dropped)} />
          <RuntimeDatum label="Avg latency" value={metrics.averageLatencyMs ? `${metrics.averageLatencyMs}ms` : "—"} />
        </div>
      </section>
      <ActorControlPanel
        actors={actors}
        contexts={snapshot.contexts.map((context) => ({
          id: context.contextId,
          name: context.name,
        }))}
        mutateActor={mutateActor}
        mutation={mutation}
      />
      {snapshot.contexts.map((context) => {
        const session = sessionView(context.session);
        const focusNames = (context.activity?.focusActorIds ?? [])
          .map((actorId) => actors.find((actor) => actor.id === actorId)?.name ?? actorId)
          .join("、");
        return (
          <section className="runtime-context" key={context.contextId}>
            <div className="debug-section-title">
              <ServerCog size={16} />
              <strong>{context.name}</strong>
              <span className={`debug-state-dot is-${context.status}`} />{context.status}
            </div>
            <div className="runtime-line-grid">
              <RuntimeDatum label="Actor runtime" value={context.actorRuntime.activation} />
              <RuntimeDatum label="Player routing" value={context.actorRuntime.playerRouting} />
              <RuntimeDatum label="Focus" value={focusNames || "—"} />
              <RuntimeDatum
                label="Ambient"
                value={context.actorRuntime.ambient === "off"
                  ? "off"
                  : context.activity?.nextAmbientAt
                    ? relativeTime(context.activity.nextAmbientAt)
                    : context.activity?.ambientNoopCount === 3
                      ? "backed off"
                      : "—"}
              />
            </div>
            <div className="runtime-queue-columns">
              <QueueColumn title="Triggers" values={session.queues.triggers.map((item) => `${item.type} → ${item.target}`)} />
              <QueueColumn title="Generating" values={session.queues.generating.map((item) => `${item.speaker} · ${item.status}`)} />
              <QueueColumn title="Scheduled" values={session.queues.scheduled.map((item) => `${item.speaker} · ${item.remainingSec.toFixed(1)}s`)} />
            </div>
            <div className="runtime-actor-table">
              <div className="runtime-table-head"><span>Actor</span><span>Attention</span><span>Next idle</span><span>Silent</span><span>状态</span></div>
              {session.characters.map((character) => (
                <div key={character.name}>
                  <strong>{character.name}</strong>
                  <span>{character.state.attention}</span>
                  <span>{character.runtime.idleRemainingSec != null ? `${character.runtime.idleRemainingSec}s` : "—"}</span>
                  <span>{character.runtime.consecutiveSilentCount ?? 0}</span>
                  <span>{character.isGenerating ? "generating" : character.hasScheduled ? "scheduled" : "idle"}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <section className="runtime-context">
        <div className="debug-section-title"><MemoryStick size={16} /><strong>Memory Coordinator</strong></div>
        <div className="runtime-memory-table">
          {snapshot.memory.map(({ runtime, snapshot: memory }) => (
            <div key={runtime.actorId}>
              <strong>{runtime.actorId}</strong>
              <span>{runtime.status}</span>
              <span>pending {runtime.pendingEventIds.length}</span>
              <span>cursor #{runtime.lastProcessedSequence}</span>
              <span>rev {memory.revision}</span>
              <span>{runtime.candidateEventCount} candidate anchors</span>
              <span>{runtime.dueAt ? relativeTime(runtime.dueAt) : "—"}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActorControlPanel({
  actors,
  contexts,
  mutateActor,
  mutation,
}: {
  actors: WorldView["actors"];
  contexts: Array<{ id: string; name: string }>;
  mutateActor: (
    actorId: string,
    action: "presence" | "participation" | "control",
    body?: Record<string, unknown>,
  ) => Promise<void>;
  mutation: { key?: string; error?: string };
}) {
  return (
    <section className="runtime-context actor-control-panel">
      <div className="debug-section-title">
        <Users size={16} />
        <strong>Actor control</strong>
        <span>World state / Context participation / authority</span>
      </div>
      {mutation.error && <div className="actor-control-error"><AlertCircle size={13} />{mutation.error}</div>}
      <div className="actor-control-list">
        {actors.map((actor) => (
          <ActorControlRow
            key={actor.id}
            actor={actor}
            contexts={contexts}
            busyKey={mutation.key}
            mutateActor={mutateActor}
          />
        ))}
      </div>
    </section>
  );
}

function ActorControlRow({
  actor,
  contexts,
  busyKey,
  mutateActor,
}: {
  actor: WorldView["actors"][number];
  contexts: Array<{ id: string; name: string }>;
  busyKey?: string;
  mutateActor: (
    actorId: string,
    action: "presence" | "participation" | "control",
    body?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [status, setStatus] = useState(actor.status ?? "");
  useEffect(() => setStatus(actor.status ?? ""), [actor.status]);
  const busy = busyKey?.startsWith(`${actor.id}:`) ?? false;
  const control = actor.control ?? {
    directorAuthority: actor.playerControlled ? "observe" as const : "coordinate" as const,
  };

  return (
    <div className={`actor-control-row is-${actor.presence ?? "online"}`}>
      <div className="actor-control-identity">
        <span className="actor-presence-light" />
        <div><strong>{actor.name}</strong><code>{actor.id}</code></div>
      </div>
      <div className="actor-control-field">
        <label>Presence</label>
        <div className="actor-segmented">
          {(["online", "away", "offline"] as const).map((presence) => (
            <button
              key={presence}
              className={actor.presence === presence ? "is-active" : ""}
              disabled={busy}
              onClick={() => void mutateActor(actor.id, "presence", {
                presence,
                status,
              })}
            >
              {presence}
            </button>
          ))}
        </div>
      </div>
      <div className="actor-control-field actor-status-field">
        <label htmlFor={`actor-status-${actor.id}`}>Status</label>
        <div>
          <input
            id={`actor-status-${actor.id}`}
            value={status}
            maxLength={120}
            placeholder="无公开状态"
            onChange={(event) => setStatus(event.target.value)}
          />
          <button
            className="icon-button"
            title="保存状态"
            disabled={busy}
            onClick={() => void mutateActor(actor.id, "presence", {
              presence: actor.presence ?? "online",
              status,
            })}
          >
            <Save size={13} />
          </button>
        </div>
      </div>
      <div className="actor-control-field">
        <label>Director</label>
        <select
          value={control.directorAuthority}
          disabled={busy}
          onChange={(event) => void mutateActor(actor.id, "control", {
            directorAuthority: event.target.value,
          })}
        >
          <option value="observe">observe</option>
          <option value="coordinate">coordinate</option>
          <option value="manage">manage</option>
        </select>
      </div>
      <div className="actor-context-controls">
        {contexts.map((context) => {
          const participation = actor.contexts?.find(
            (item) => item.contextId === context.id,
          )?.participation ?? "left";
          return (
            <label key={context.id}>
              <span>{context.name}</span>
              <select
                value={participation}
                disabled={busy}
                onChange={(event) => void mutateActor(actor.id, "participation", {
                  contextId: context.id,
                  participation: event.target.value,
                })}
              >
                <option value="joined">joined</option>
                <option value="muted">muted</option>
                <option value="left">left</option>
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function MemoryPanel({
  snapshot,
  selectedId,
  onSelect,
}: {
  snapshot: WorldDebugSnapshot;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const graph = useMemo(() => buildMemoryGraph(snapshot), [snapshot]);
  return (
    <section className="debug-graph-panel">
      <header className="debug-panel-heading">
        <div><strong>Actor Memory Graph</strong><span>{graph.nodes.length} nodes · {graph.edges.length} edges</span></div>
      </header>
      {graph.nodes.length ? (
        <ReactFlow
          nodes={graph.nodes.map((node) => ({ ...node, selected: node.id === selectedId }))}
          edges={graph.edges}
          onNodeClick={(_, node) => onSelect(node.id)}
          fitView
          minZoom={0.25}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="#cbd5ce" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
      ) : <PanelEmpty icon={<BrainCircuit />} text="还没有长期记忆节点" />}
    </section>
  );
}

export function NarrativePanel({ snapshot }: { snapshot: WorldDebugSnapshot }) {
  return (
    <div className="debug-scroll-panel narrative-debug-panel">
      <section>
        <div className="debug-section-title"><GitBranch size={16} /><strong>Chapters</strong></div>
        {snapshot.narrative.chapters.map((chapter) => (
          <article key={chapter.id}>
            <span>{chapter.status}</span><strong>{chapter.title}</strong><p>{chapter.targetOutcome}</p>
            <small>{chapter.beatIds.length} beats</small>
          </article>
        ))}
      </section>
      <section>
        <div className="debug-section-title"><Activity size={16} /><strong>Beat DAG</strong></div>
        <div className="narrative-debug-list">
          {snapshot.narrative.beats.map((beat) => (
            <article key={beat.id}>
              <code>{beat.id}</code><strong>{beat.title}</strong><p>{beat.outcome ?? beat.brief}</p>
              <small>sources: {beat.sourceEventIds.join(", ") || "—"}</small>
              {beat.sourceBasis && (
                <small>
                  world source: {beat.sourceBasis.bundleId}@{beat.sourceBasis.bindingRevision}
                  {` · ${beat.sourceBasis.adherence} · ${beat.sourceBasis.chunkIds.join(", ")}`}
                </small>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function RawSnapshot({ snapshot }: { snapshot: WorldDebugSnapshot }) {
  return <pre className="debug-raw">{JSON.stringify(snapshot, null, 2)}</pre>;
}

export function EventInspector({ event }: { event?: WorldDebugEvent }) {
  if (!event) return <PanelEmpty icon={<Activity />} text="选择一条事件查看详情" />;
  return (
    <>
      <header className="inspector-debug-heading">
        <span className={`debug-category-mark is-${event.category}`} />
        <div><strong>{event.type}</strong><small>#{event.sequence} · {formatTime(event.occurredAt)}</small></div>
        <button className="icon-button" title="复制事件" onClick={() => void navigator.clipboard.writeText(JSON.stringify(event, null, 2))}><Copy size={14} /></button>
      </header>
      <InspectorSection title="Scope">
        <InspectorRow label="category" value={event.category} />
        <InspectorRow label="level" value={event.level} />
        <InspectorRow label="context" value={event.contextId ?? "—"} />
        <InspectorRow label="actor" value={event.actorId ?? "—"} />
      </InspectorSection>
      <InspectorSection title="Causality">
        <InspectorRow label="causation" value={event.causationId ?? "—"} />
        <InspectorRow label="correlation" value={event.correlationId ?? "—"} />
      </InspectorSection>
      <InspectorSection title="Payload">
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </InspectorSection>
    </>
  );
}

export function MemoryInspector({
  node,
  snapshot,
}: {
  node?: ActorMemoryNode;
  snapshot: WorldDebugSnapshot;
}) {
  if (!node) return <PanelEmpty icon={<BrainCircuit />} text="选择一个记忆节点" />;
  const owner = snapshot.memory.find((item) => item.snapshot.nodes.some((candidate) => candidate.id === node.id));
  const document = owner?.snapshot.documents.find((candidate) => candidate.id === node.id);
  const edges = owner?.snapshot.edges.filter((edge) => edge.fromNodeId === node.id) ?? [];
  return (
    <>
      <header className="inspector-debug-heading">
        <span className={`memory-kind-mark is-${node.kind}`} />
        <div><strong>{node.title}</strong><small>{node.kind} · {node.status ?? "active"}</small></div>
      </header>
      <InspectorSection title="Content"><p className="memory-node-content">{node.content}</p></InspectorSection>
      <InspectorSection title="Metadata">
        <InspectorRow label="owner" value={owner?.runtime.actorId ?? "—"} />
        <InspectorRow label="document" value={document?.path ?? "—"} />
        <InspectorRow label="importance" value={String(node.importance ?? "—")} />
        <InspectorRow label="confidence" value={String(node.confidence ?? "—")} />
      </InspectorSection>
      <InspectorSection title="Sources">
        <div className="inspector-id-list">{node.sourceEventIds?.map((id) => <code key={id}>{id}</code>) ?? "—"}</div>
      </InspectorSection>
      <InspectorSection title="Edges">
        {edges.length ? edges.map((edge) => <InspectorRow key={edge.id} label={edge.type} value={edge.toId} />) : "—"}
      </InspectorSection>
    </>
  );
}

function QueueColumn({ title, values }: { title: string; values: string[] }) {
  return <div><header><strong>{title}</strong><span>{values.length}</span></header>{values.length ? values.map((value, index) => <p key={`${value}-${index}`}>{value}</p>) : <small>empty</small>}</div>;
}

function RuntimeDatum({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="debug-inspector-section"><h2>{title}</h2>{children}</section>;
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return <div className="debug-inspector-row"><span>{label}</span><code>{value}</code></div>;
}

function PanelEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="debug-empty">{icon}<span>{text}</span></div>;
}
