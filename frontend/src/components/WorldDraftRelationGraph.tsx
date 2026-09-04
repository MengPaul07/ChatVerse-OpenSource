import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowRight,
  Focus,
  GitBranch,
  Network,
  Plus,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type {
  DraftRelation,
  WorldDraft,
  WorldDraftOperation,
} from "@chatverse/world-authoring";

interface Props {
  draft: WorldDraft;
  disabled: boolean;
  onApply: (operations: WorldDraftOperation[], summary: string) => Promise<void>;
  onClose: () => void;
}

interface PersonData extends Record<string, unknown> {
  name: string;
  summary: string;
  kind: "actor" | "player";
  relationCount: number;
}

type PersonNode = Node<PersonData, "person">;
type RelationEdge = Edge<{ relationId: string; description: string; reciprocal: boolean }, "relation">;
type Selection = { kind: "node"; id: string } | { kind: "relation"; id: string } | { kind: "create" } | null;

const nodeTypes = { person: PersonNodeCard };
const edgeTypes = { relation: RelationEdgeView };

export default function WorldDraftRelationGraph(props: Props) {
  const workbench = (
    <ReactFlowProvider>
      <WorldDraftRelationGraphContent {...props} />
    </ReactFlowProvider>
  );

  return typeof document === "undefined"
    ? workbench
    : createPortal(workbench, document.body);
}

function WorldDraftRelationGraphContent({ draft, disabled, onApply, onClose }: Props) {
  const model = useMemo(() => buildModel(draft), [draft]);
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonNode>(model.nodes);
  const [selection, setSelection] = useState<Selection>(null);
  const [notice, setNotice] = useState<string>();
  const flowRef = useRef<ReactFlowInstance<PersonNode, RelationEdge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    setNodes((current) => model.nodes.map((node) => ({
      ...node,
      position: current.find((item) => item.id === node.id)?.position ?? node.position,
    })));
  }, [model.nodes, setNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, duration: 180 }));
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (selection?.kind === "relation" && !draft.relations.some((item) => item.id === selection.id)) setSelection(null);
    if (selection?.kind === "node" && !model.nodes.some((item) => item.id === selection.id)) setSelection(null);
  }, [draft.relations, model.nodes, selection]);

  const focusedIds = useMemo(() => {
    if (selection?.kind === "node") {
      const ids = new Set([selection.id]);
      for (const edge of model.edges) {
        if (edge.source === selection.id) ids.add(edge.target);
        if (edge.target === selection.id) ids.add(edge.source);
      }
      return ids;
    }
    if (selection?.kind === "relation") {
      const edge = model.edges.find((item) => item.data?.relationId === selection.id);
      return edge ? new Set([edge.source, edge.target]) : undefined;
    }
    return undefined;
  }, [model.edges, selection]);

  const displayNodes = nodes.map((node) => ({
    ...node,
    selected: selection?.kind === "node" && selection.id === node.id,
    style: { ...node.style, opacity: focusedIds && !focusedIds.has(node.id) ? 0.28 : 1 },
  }));
  const displayEdges = model.edges.map((edge) => {
    const selected = selection?.kind === "relation" && selection.id === edge.data?.relationId;
    const connected = !focusedIds || focusedIds.has(edge.source) && focusedIds.has(edge.target);
    return {
      ...edge,
      selected,
      style: {
        opacity: connected ? 1 : 0.12,
        stroke: selected ? "#087f6a" : "#778079",
        strokeWidth: selected ? 2.4 : 1.45,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: selected ? "#087f6a" : "#778079",
      },
    };
  });

  async function connect(connection: Connection) {
    if (disabled || !connection.source || !connection.target) return;
    const error = relationError(draft.relations, connection.source, connection.target);
    if (error) {
      setNotice(error);
      return;
    }
    setNotice(undefined);
    await onApply([{
      type: "upsert_relation",
      relation: {
        fromActorId: connection.source,
        toActorId: connection.target,
        description: "尚未定义的关系",
      },
    }], "在关系图中新增关系");
  }

  function resetLayout() {
    setNodes(model.nodes);
    window.setTimeout(() => flowRef.current?.fitView({ padding: 0.18, duration: 300 }), 0);
  }

  return (
    <div className="relation-studio" role="dialog" aria-modal="true" aria-label="世界关系图谱">
      <header className="relation-studio-header">
        <div className="relation-studio-title">
          <div className="relation-studio-mark"><Network size={19} /></div>
          <div>
            <span>WORLD RELATION MAP</span>
            <h2>世界关系图谱</h2>
            <p>{model.nodes.length} 位参与者 · {draft.relations.length} 条定向关系</p>
          </div>
        </div>
        <div className="relation-studio-toolbar">
          <button disabled={disabled || model.nodes.length < 2} onClick={() => setSelection({ kind: "create" })} className="button button-primary"><Plus size={15} />新增关系</button>
          <button onClick={resetLayout} className="icon-button" title="重新布局"><Focus size={17} /></button>
          <button onClick={onClose} className="icon-button" title="关闭关系图谱"><X size={18} /></button>
        </div>
      </header>
      {notice && <div className="relation-studio-notice" role="status"><span>{notice}</span><button onClick={() => setNotice(undefined)} className="icon-button" title="关闭提示"><X size={14} /></button></div>}
      <main className="relation-studio-main">
        <div ref={canvasRef} className="relation-graph-canvas">
          <div className="relation-canvas-caption"><span>关系地图</span><p>拖拽角色调整布局，连接节点创建定向关系</p></div>
          <ReactFlow<PersonNode, RelationEdge>
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => setSelection({ kind: "node", id: node.id })}
            onEdgeClick={(_, edge) => edge.data && setSelection({ kind: "relation", id: edge.data.relationId })}
            onPaneClick={() => setSelection(null)}
            onConnect={(connection) => void connect(connection)}
            onInit={(instance) => { flowRef.current = instance; }}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
            minZoom={0.25}
            maxZoom={1.8}
            connectionMode={ConnectionMode.Loose}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(23, 26, 24, 0.12)" gap={28} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        </div>
        <RelationInspector
          draft={draft}
          nodes={model.nodes}
          selection={selection}
          disabled={disabled}
          onSelect={setSelection}
          onApply={onApply}
          onNotice={setNotice}
        />
      </main>
    </div>
  );
}

function RelationInspector({ draft, nodes, selection, disabled, onSelect, onApply, onNotice }: {
  draft: WorldDraft;
  nodes: PersonNode[];
  selection: Selection;
  disabled: boolean;
  onSelect: (selection: Selection) => void;
  onApply: Props["onApply"];
  onNotice: (notice?: string) => void;
}) {
  const selectedRelation = selection?.kind === "relation"
    ? draft.relations.find((item) => item.id === selection.id)
    : undefined;
  const selectedNode = selection?.kind === "node"
    ? nodes.find((item) => item.id === selection.id)
    : undefined;

  if (selection?.kind === "create") {
    return <RelationForm nodes={nodes} relations={draft.relations} disabled={disabled} onCancel={() => onSelect(null)} onApply={onApply} onNotice={onNotice} />;
  }
  if (selectedRelation) {
    return <RelationForm key={selectedRelation.id} nodes={nodes} relations={draft.relations} relation={selectedRelation} disabled={disabled} onCancel={() => onSelect(null)} onApply={onApply} onNotice={onNotice} />;
  }
  if (selectedNode) {
    const connected = draft.relations.filter((relation) => relation.fromActorId === selectedNode.id || relation.toActorId === selectedNode.id);
    return (
      <InspectorShell icon={selectedNode.data.kind === "player" ? <UserRound size={17} /> : <UsersRound size={17} />} title={selectedNode.data.name} subtitle={selectedNode.data.kind === "player" ? "玩家视角" : "世界角色"}>
        <p className="relation-person-summary">{selectedNode.data.summary}</p>
        <div className="relation-connected">
          <div className="relation-connected-heading"><span>相关关系</span><small>{connected.length}</small></div>
          <div className="relation-connected-list">
            {connected.map((relation) => (
              <button key={relation.id} onClick={() => onSelect({ kind: "relation", id: relation.id })}>
                <div><span>{nodeName(nodes, relation.fromActorId)}</span><ArrowRight size={12} /><span>{nodeName(nodes, relation.toActorId)}</span></div>
                <p>{relation.description}</p>
              </button>
            ))}
            {connected.length === 0 && <p className="relation-empty-copy">暂无相关关系</p>}
          </div>
        </div>
      </InspectorShell>
    );
  }
  return (
    <InspectorShell icon={<Network size={17} />} title="图谱概览" subtitle="WorldDraft 稳定 ID 关系">
      <div className="relation-stats"><Stat value={nodes.length} label="成员" /><Stat value={draft.relations.length} label="关系" /></div>
      <div className="relation-ranking">
        {[...nodes].sort((left, right) => right.data.relationCount - left.data.relationCount).map((node) => (
          <button key={node.id} onClick={() => onSelect({ kind: "node", id: node.id })}><span>{node.data.name}</span><small>{node.data.relationCount}</small></button>
        ))}
      </div>
    </InspectorShell>
  );
}

function RelationForm({ nodes, relations, relation, disabled, onCancel, onApply, onNotice }: {
  nodes: PersonNode[];
  relations: DraftRelation[];
  relation?: DraftRelation;
  disabled: boolean;
  onCancel: () => void;
  onApply: Props["onApply"];
  onNotice: (notice?: string) => void;
}) {
  const [fromActorId, setFromActorId] = useState(relation?.fromActorId ?? nodes[0]?.id ?? "");
  const [toActorId, setToActorId] = useState(relation?.toActorId ?? nodes.find((node) => node.id !== fromActorId)?.id ?? "");
  const [description, setDescription] = useState(relation?.description ?? "");

  async function save() {
    const error = relationError(relations, fromActorId, toActorId, relation?.id);
    if (error) return onNotice(error);
    if (!description.trim()) return onNotice("请填写关系描述");
    onNotice(undefined);
    await onApply([{
      type: "upsert_relation",
      relation: { id: relation?.id, fromActorId, toActorId, description: description.trim() },
    }], relation ? "在关系图中修改关系" : "在关系图中新增关系");
  }

  return (
    <InspectorShell icon={relation ? <GitBranch size={17} /> : <Plus size={17} />} title={relation ? "关系详情" : "新增关系"} subtitle="定向关系">
      <MemberSelect label="来源" value={fromActorId} nodes={nodes} onChange={setFromActorId} />
      <div className="relation-direction-mark"><ArrowRight size={17} /></div>
      <MemberSelect label="目标" value={toActorId} nodes={nodes} onChange={setToActorId} />
      <label className="relation-field"><span>关系描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={6} className="relation-textarea" /></label>
      <div className="relation-panel-actions">
        <button onClick={onCancel} className="button button-quiet">取消</button>
        <button disabled={disabled || nodes.length < 2} onClick={() => void save()} className="button button-primary">保存</button>
      </div>
      {relation && (
        <button disabled={disabled} onClick={() => void onApply([{ type: "remove_relation", relationId: relation.id }], "在关系图中删除关系")} className="relation-delete-button"><Trash2 size={15} />删除关系</button>
      )}
    </InspectorShell>
  );
}

function PersonNodeCard({ data, selected }: NodeProps<PersonNode>) {
  const isPlayer = data.kind === "player";
  return (
    <div className={`relation-person-node group${selected ? " is-selected" : ""}${isPlayer ? " is-user" : ""}`}>
      <GraphHandle id="left" position={Position.Left} />
      <GraphHandle id="top" position={Position.Top} />
      <div className="relation-node-main">
        <div className={`relation-node-avatar ${isPlayer ? "is-user" : avatarTone(data.name)}`}>{data.name.slice(0, 1) || "?"}</div>
        <div className="relation-node-copy"><div><span>{data.name || "未命名成员"}</span>{isPlayer && <UserRound size={12} />}</div><p>{data.summary}</p></div>
        <span className="relation-node-degree">{data.relationCount}</span>
      </div>
      <div className="relation-node-kind">{isPlayer ? "玩家视角" : "世界角色"}</div>
      <GraphHandle id="right" position={Position.Right} />
      <GraphHandle id="bottom" position={Position.Bottom} />
    </div>
  );
}

function GraphHandle({ id, position }: { id: string; position: Position }) {
  return <><Handle id={`target-${id}`} type="target" position={position} className="relation-target-handle" /><Handle id={`source-${id}`} type="source" position={position} className="relation-source-handle" /></>;
}

function RelationEdgeView(props: EdgeProps<RelationEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    curvature: props.data?.reciprocal ? 0.42 : 0.25,
  });
  return <><BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={22} /><EdgeLabelRenderer><div className={`relation-edge-label nodrag nopan${props.selected ? " is-selected" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{compactLabel(props.data?.description ?? "关系")}</div></EdgeLabelRenderer></>;
}

function buildModel(draft: WorldDraft): { nodes: PersonNode[]; edges: RelationEdge[] } {
  const people = [
    ...(draft.player ? [{ id: draft.player.id, name: draft.player.profile.name, summary: draft.player.profile.card || "玩家", kind: "player" as const }] : []),
    ...draft.actors.map((actor) => ({ id: actor.id, name: actor.card.name, summary: actor.card.description || actor.card.personality, kind: "actor" as const })),
  ];
  const knownIds = new Set(people.map((person) => person.id));
  const countById = new Map<string, number>();
  for (const relation of draft.relations) {
    countById.set(relation.fromActorId, (countById.get(relation.fromActorId) ?? 0) + 1);
    countById.set(relation.toActorId, (countById.get(relation.toActorId) ?? 0) + 1);
  }
  const nodes = people.map((person, index): PersonNode => {
    const angle = -Math.PI / 2 + Math.PI * 2 * index / Math.max(people.length, 1);
    return {
      id: person.id,
      type: "person",
      position: { x: 360 + Math.cos(angle) * 260, y: 260 + Math.sin(angle) * 190 },
      data: { ...person, relationCount: countById.get(person.id) ?? 0 },
    };
  });
  const edges = draft.relations.filter((relation) => knownIds.has(relation.fromActorId) && knownIds.has(relation.toActorId)).map((relation): RelationEdge => ({
    id: relation.id,
    type: "relation",
    source: relation.fromActorId,
    target: relation.toActorId,
    data: {
      relationId: relation.id,
      description: relation.description,
      reciprocal: draft.relations.some((candidate) => candidate.fromActorId === relation.toActorId && candidate.toActorId === relation.fromActorId),
    },
  }));
  return { nodes, edges };
}

function relationError(relations: DraftRelation[], from: string, to: string, currentId?: string): string | undefined {
  if (!from || !to) return "请选择关系两端";
  if (from === to) return "暂不支持角色连接自己";
  if (relations.some((relation) => relation.id !== currentId && relation.fromActorId === from && relation.toActorId === to)) return "这条同方向关系已经存在";
  return undefined;
}

function InspectorShell({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return <aside className="relation-inspector"><div className="relation-inspector-heading"><div>{icon}</div><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="relation-inspector-content">{children}</div></aside>;
}

function MemberSelect({ label, value, nodes, onChange }: { label: string; value: string; nodes: PersonNode[]; onChange: (value: string) => void }) {
  return <label className="relation-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="relation-select">{nodes.map((node) => <option key={node.id} value={node.id}>{node.data.name}</option>)}</select></label>;
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="relation-stat"><strong>{value}</strong><span>{label}</span></div>;
}

function nodeName(nodes: PersonNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.data.name ?? "未知";
}

function compactLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "关系";
  return normalized.length > 16 ? `${normalized.slice(0, 16)}…` : normalized;
}

function avatarTone(name: string): string {
  const colors = ["tone-forest", "tone-clay", "tone-violet", "tone-amber", "tone-ocean"];
  return colors[Math.abs((name || "?").charCodeAt(0)) % colors.length]!;
}
