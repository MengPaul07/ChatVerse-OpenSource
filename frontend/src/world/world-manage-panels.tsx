import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  GitBranch,
  LockKeyhole,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Users,
  WandSparkles,
} from "lucide-react";
import type { ActorPresence, ContextParticipation, WorldDirectorActorAuthority } from "@chatverse/core";
import { Link } from "react-router-dom";
import type { WorldView } from "./types";
import type { WorldRoomController } from "./WorldRoomContext";

export type ManageSection = "overview" | "contexts" | "actors" | "story" | "runtime";
type ChangeRunner = (
  change: () => Promise<boolean> | Promise<void>,
  success: string,
) => Promise<void>;

export function WorldManageContent({
  section,
  view,
  context,
  activeContextId,
  contextChatPath,
  chatPath,
  room,
  isBusy,
  runChange,
}: {
  section: ManageSection;
  view: WorldView;
  context?: WorldView["contexts"][number];
  activeContextId?: string;
  contextChatPath: (contextId: string) => string;
  chatPath: string;
  room: WorldRoomController;
  isBusy: boolean;
  runChange: ChangeRunner;
}) {
  return (
    <>
      {section === "overview" && (
        <OverviewPanel
          view={view}
          context={context}
          activeContextId={activeContextId}
          contextChatPath={contextChatPath}
          chatPath={chatPath}
          room={room}
          isBusy={isBusy}
          runChange={runChange}
        />
      )}
      {section === "contexts" && (
        <ContextsPanel view={view} activeContextId={activeContextId} contextChatPath={contextChatPath} />
      )}
      {section === "actors" && (
        <ActorsPanel view={view} context={context} room={room} disabled={isBusy} runChange={runChange} />
      )}
      {section === "story" && <StoryPanel view={view} context={context} chatPath={chatPath} />}
      {section === "runtime" && (
        <RuntimePanel view={view} context={context} room={room} isBusy={isBusy} runChange={runChange} />
      )}
    </>
  );
}
function OverviewPanel({
  view,
  context,
  activeContextId,
  contextChatPath,
  chatPath,
  room,
  isBusy,
  runChange,
}: {
  view: WorldView;
  context?: WorldView["contexts"][number];
  activeContextId?: string;
  contextChatPath: (contextId: string) => string;
  chatPath: string;
  room: WorldRoomController;
  isBusy: boolean;
  runChange: ChangeRunner;
}) {
  return (
    <>
      <section className="world-management-stats" aria-label="世界概览">
        <WorldStat icon={<CalendarClock size={16} />} label="世界时间" value={formatTime(view.world.worldTime)} />
        <WorldStat icon={<MessageCircle size={16} />} label="已发生" value={`${view.entries.length} 条记录`} />
        <WorldStat icon={<GitBranch size={16} />} label="剧情节点" value={`${view.narrative.beats.length} 个 Beat`} />
        <WorldStat icon={<Users size={16} />} label="当前角色" value={`${view.actors.length} 位`} />
      </section>

      <div className="world-management-grid">
        <div className="world-management-column">
          <section className="world-management-section">
            <SectionHeading icon={<MessageCircle size={17} />} eyebrow="聊天空间" title="从这里进入对话" detail="每个空间共享同一套角色身份与世界设定，但聊天记录彼此独立。" />
            <ContextList view={view} activeContextId={activeContextId} contextChatPath={contextChatPath} />
          </section>
          <ScenePanel context={context} chatPath={chatPath} />
        </div>
        <div className="world-management-column">
          <DirectorPanel view={view} room={room} disabled={isBusy} runChange={runChange} />
          <StoryChaptersPanel chapters={view.narrative.chapters} />
        </div>
      </div>
    </>
  );
}

function ContextsPanel({
  view,
  activeContextId,
  contextChatPath,
}: {
  view: WorldView;
  activeContextId?: string;
  contextChatPath: (contextId: string) => string;
}) {
  return (
    <section className="world-management-section world-management-section-wide">
      <SectionHeading icon={<MessageCircle size={17} />} eyebrow="空间列表" title={`${view.contexts.length} 个对话现场`} detail="群聊、私聊和未来的其他 Context 都从这里进入。" />
      <ContextList view={view} activeContextId={activeContextId} contextChatPath={contextChatPath} detailed />
    </section>
  );
}

function ActorsPanel({
  view,
  context,
  room,
  disabled,
  runChange,
}: {
  view: WorldView;
  context?: WorldView["contexts"][number];
  room: WorldRoomController;
  disabled: boolean;
  runChange: ChangeRunner;
}) {
  return (
    <section className="world-management-section world-management-section-wide">
      <SectionHeading icon={<Users size={17} />} eyebrow="世界成员" title="角色与参与方式" detail="在线状态属于世界，场景参与只影响当前聊天空间。" />
      <div className="world-management-actors">
        {view.actors.map((actor) => (
          <ActorManagementRow
            key={actor.id}
            actor={actor}
            contextId={context?.id}
            disabled={disabled}
            onPresence={(presence) => void runChange(
              () => room.setActorPresence(actor.id, presence),
              `${actor.name} 的在线状态已更新。`,
            )}
            onParticipation={(participation) => context && void runChange(
              () => room.setActorParticipation(actor.id, context.id, participation),
              `${actor.name} 的场景参与方式已更新。`,
            )}
            onControl={(policy) => void runChange(
              () => room.updateActorControl(actor.id, policy),
              `${actor.name} 的运行边界已更新。`,
            )}
          />
        ))}
      </div>
    </section>
  );
}

function StoryPanel({ view, context, chatPath }: { view: WorldView; context?: WorldView["contexts"][number]; chatPath: string }) {
  return (
    <div className="world-management-grid">
      <StoryChaptersPanel chapters={view.narrative.chapters} />
      <ScenePanel context={context} chatPath={chatPath} />
    </div>
  );
}

function RuntimePanel({
  view,
  context,
  room,
  isBusy,
  runChange,
}: {
  view: WorldView;
  context?: WorldView["contexts"][number];
  room: WorldRoomController;
  isBusy: boolean;
  runChange: ChangeRunner;
}) {
  return (
    <div className="world-management-grid">
      <section className="world-management-section">
        <SectionHeading icon={<Settings2 size={17} />} eyebrow="运行策略" title="这次世界如何推进" detail="这些配置决定当前实例的节奏和调度边界。" />
        <div className="world-management-facts">
          <RuntimeFact label="剧情推进" value={view.runtime.directorEnabled ? "导演协调，角色自主回应" : "关闭"} />
          <RuntimeFact label="当前场景" value={context ? `${context.name} · ${contextStatusLabel(context.status)}` : "暂无场景"} />
          <RuntimeFact label="Actor 调度" value={context ? actorRuntimeLabel(context.actorRuntime) : "未开始"} />
        </div>
        {context && context.conversationMode !== "group" && context.conversationMode !== "private" && (
          <PresentationPolicyControls
            context={context}
            room={room}
            disabled={isBusy}
            runChange={runChange}
          />
        )}
        <div className="world-management-callout">
          <Settings2 size={16} />
          <span>想改变世界模式，请回到世界创作页调整作品配置，再创建新的世界实例。</span>
        </div>
      </section>
      <DirectorPanel view={view} room={room} disabled={isBusy} runChange={runChange} />
    </div>
  );
}

function PresentationPolicyControls({
  context,
  room,
  disabled,
  runChange,
}: {
  context: WorldView["contexts"][number];
  room: WorldRoomController;
  disabled: boolean;
  runChange: ChangeRunner;
}) {
  const [prefetch, setPrefetch] = useState(context.presentationPrefetchLimit);

  useEffect(() => {
    setPrefetch(context.presentationPrefetchLimit);
  }, [context.id, context.presentationPrefetchLimit]);

  const dirty = prefetch !== context.presentationPrefetchLimit;

  return (
    <div className="world-presentation-policy">
      <label>
        <span><strong>预生成消息</strong><small>演出模式后台最多提前准备的内容数量</small></span>
        <select value={prefetch} onChange={(event) => setPrefetch(Number(event.target.value))} disabled={disabled}>
          {[0, 1, 3, 5, 8, 10].map((value) => <option key={value} value={value}>{value} 条</option>)}
        </select>
      </label>
      <button
        className="button button-primary"
        disabled={disabled || !dirty}
        onClick={() => void runChange(
          () => room.setPresentationPolicy({
            presentationPrefetchLimit: prefetch,
          }),
          "演出策略已更新。",
        )}
      >
        保存演出策略
      </button>
    </div>
  );
}

function ContextList({
  view,
  activeContextId,
  contextChatPath,
  detailed = false,
}: {
  view: WorldView;
  activeContextId?: string;
  contextChatPath: (contextId: string) => string;
  detailed?: boolean;
}) {
  return (
    <div className={`world-management-context-list${detailed ? " is-detailed" : ""}`}>
      {view.contexts.map((item) => (
        <Link
          className={`world-management-context-card${item.id === activeContextId ? " is-active" : ""}`}
          key={item.id}
          to={contextChatPath(item.id)}
        >
          <span className="world-management-context-card-icon">
            {item.conversationMode === "private" ? <LockKeyhole size={16} /> : <MessageCircle size={16} />}
          </span>
          <span className="world-management-context-card-copy">
            <strong>{item.name}</strong>
            <small>{item.conversationMode === "private" ? "私聊" : item.id === view.contexts[0]?.id ? "世界" : "群聊"} · {item.actorIds.length} 位参与者 · {contextStatusLabel(item.status)}</small>
            {detailed && <em>{item.scene?.text || "这个空间还没有新的场景描述。"}</em>}
          </span>
          <span className="world-management-context-card-action">打开 <ArrowRight size={14} /></span>
        </Link>
      ))}
    </div>
  );
}

function DirectorPanel({
  view,
  room,
  disabled,
  runChange,
}: {
  view: WorldView;
  room: WorldRoomController;
  disabled: boolean;
  runChange: ChangeRunner;
}) {
  return (
    <section className="world-management-section world-management-director">
      <SectionHeading icon={<WandSparkles size={17} />} eyebrow="导演" title="宏观推进状态" detail="导演只负责旁白、剧情和唤醒机会，不代替角色说话。" />
      <div className={`director-management-status is-${view.director.status}`}>
        <span className="director-status-dot" />
        <div><strong>{directorStatusLabel(view.director.status)}</strong><small>{view.director.objective || "等待新的世界事实。"}</small></div>
      </div>
      <div className="director-management-meta">
        <span>当前任务</span><strong>{view.director.reason || "无"}</strong>
        {view.director.dueAt && <><span>预计处理</span><strong>{formatTime(view.director.dueAt)}</strong></>}
      </div>
      <button className="button button-primary world-management-progress" onClick={() => void runChange(room.requestProgression, "已请求导演继续观察。")} disabled={disabled || !view.runtime.directorEnabled || view.world.status !== "running"}>
        <RefreshCw size={15} />继续观察
      </button>
    </section>
  );
}

function StoryChaptersPanel({ chapters }: { chapters: WorldView["narrative"]["chapters"] }) {
  return (
    <section className="world-management-section">
      <SectionHeading icon={<GitBranch size={17} />} eyebrow="剧情章节" title="故事脉络" detail="章节记录一个阶段如何打开、发展并走向结果。" />
      <div className="world-management-chapters">
        {chapters.length === 0 ? <p className="world-management-empty">故事还没有形成独立章节。</p> : chapters.map((chapter) => (
          <article key={chapter.id} className="world-management-chapter">
            <div><span className={`chapter-state is-${chapter.status}`} /> <strong>{chapter.title}</strong></div>
            <p>{chapter.targetOutcome}</p>
            <small>{chapter.beatIds.length} 个已记录节点 · {chapterStatusLabel(chapter.status)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScenePanel({ context, chatPath }: { context?: WorldView["contexts"][number]; chatPath: string }) {
  return (
    <section className="world-management-section world-management-scene">
      <SectionHeading icon={<CalendarClock size={17} />} eyebrow="场景" title={context?.name || "当前场景"} detail="场景是角色共同感知的环境事实。" />
      <p>{context?.scene?.text || "世界正在等待新的事实。"}</p>
      <Link className="text-link" to={chatPath}>回到对话查看完整进展 <ArrowLeft size={13} /></Link>
    </section>
  );
}

export function WorldStatusActions({
  view,
  room,
  disabled,
  runChange,
}: {
  view: WorldView;
  room: WorldRoomController;
  disabled: boolean;
  runChange: ChangeRunner;
}) {
  return (
    <div className="world-management-intro-actions">
      {view.world.status === "idle" && (
        <button className="button button-primary" onClick={() => void runChange(room.start, "世界已开始运行。")} disabled={disabled}>
          <Play size={15} />开始
        </button>
      )}
      {view.world.status === "running" && (
        <button className="button button-quiet" onClick={() => void runChange(room.pause, "世界已暂停。")} disabled={disabled}>
          <Pause size={15} />暂停
        </button>
      )}
      {view.world.status === "paused" && (
        <button className="button button-primary" onClick={() => void runChange(room.resume, "世界已继续运行。")} disabled={disabled}>
          <Play size={15} />继续
        </button>
      )}
      {(view.world.status === "running" || view.world.status === "paused") && (
        <button className="button button-quiet" onClick={() => void runChange(room.stop, "世界已停止。")} disabled={disabled}>
          <Square size={14} />停止
        </button>
      )}
    </div>
  );
}

function ActorManagementRow({
  actor,
  contextId,
  disabled,
  onPresence,
  onParticipation,
  onControl,
}: {
  actor: WorldView["actors"][number];
  contextId?: string;
  disabled: boolean;
  onPresence: (presence: ActorPresence) => void;
  onParticipation: (participation: ContextParticipation) => void;
  onControl: (policy: {
    directorAuthority?: WorldDirectorActorAuthority;
  }) => void;
}) {
  const participation = actor.contexts?.find((item) => item.contextId === contextId)?.participation ?? "left";
  const directorAuthority = actor.control?.directorAuthority ?? "coordinate";

  return (
    <article className="world-management-actor">
      <div className="world-management-actor-heading">
        <span className={`world-management-avatar is-${actor.kind}`}>{actor.name.slice(0, 1)}</span>
        <div><strong>{actor.name}</strong><small>{actor.playerControlled ? "玩家身份" : actor.description || "世界角色"}</small></div>
        <span className={`actor-presence-dot is-${actor.presence ?? "offline"}`} title={presenceLabel(actor.presence)} />
      </div>
      <div className="world-management-actor-controls">
        <label><span>在线状态</span><select value={actor.presence ?? "offline"} onChange={(event) => onPresence(event.target.value as ActorPresence)} disabled={disabled}><option value="online">在线</option><option value="away">暂离</option><option value="offline">离线</option></select></label>
        <label><span>场景参与</span><select value={participation} onChange={(event) => onParticipation(event.target.value as ContextParticipation)} disabled={disabled || !contextId}><option value="joined">参与</option><option value="muted">旁观</option><option value="left">离开</option></select></label>
        {!actor.playerControlled && <>
          <label><span>导演权限</span><select value={directorAuthority} onChange={(event) => onControl({ directorAuthority: event.target.value as WorldDirectorActorAuthority })} disabled={disabled}><option value="observe">只观察</option><option value="coordinate">可唤醒</option><option value="manage">可管理状态</option></select></label>
        </>}
      </div>
    </article>
  );
}

function SectionHeading({ icon, eyebrow, title, detail }: { icon: ReactNode; eyebrow: string; title: string; detail: string }) {
  return <header className="world-management-section-heading"><div className="world-management-section-icon">{icon}</div><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{detail}</p></div></header>;
}

function WorldStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="world-management-stat"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function RuntimeFact({ label, value }: { label: string; value: string }) {
  return <div className="world-management-fact"><span>{label}</span><strong>{value}</strong></div>;
}

export function WorldManageState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <div className="world-system-screen is-error"><div>{icon}</div><h1>{title}</h1><p>{detail}</p>{action}</div>;
}


function contextStatusLabel(status: WorldView["contexts"][number]["status"]): string {
  return { dormant: "安静", active: "正在发生", paused: "已暂停", stopped: "已停止" }[status];
}

function actorRuntimeLabel(runtime: WorldView["contexts"][number]["actorRuntime"]): string {
  if (runtime.activation === "beat_runtime") return "幕内运行，角色自主回应";
  return "角色自主活动";
}

function directorStatusLabel(status: WorldView["director"]["status"]): string {
  return { idle: "等待推进", scheduled: "即将推进", running: "正在观察", error: "需要重试" }[status];
}

function chapterStatusLabel(status: WorldView["narrative"]["chapters"][number]["status"]): string {
  return { active: "进行中", queued: "待开始", completed: "已收束", abandoned: "已放弃" }[status];
}

function presenceLabel(presence: ActorPresence | undefined): string {
  return { online: "在线", away: "暂离", offline: "离线" }[presence ?? "offline"];
}

function formatTime(value: number): string {
  if (!value) return "尚未发生";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(value);
}
