import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Circle,
  GitBranch,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useWorldRoomContext } from "../world/WorldRoomContext";
import type { WorldView } from "../world/types";

export default function WorldTasksPage() {
  const { worldId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const room = useWorldRoomContext();
  const view = room.state.view;
  if (!view) return null;

  const chapters = view.narrative.chapters;
  const base = `/worlds/${encodeURIComponent(worldId)}`;
  const chatPath = withContext(`${base}`, searchParams, view.contexts[0]?.id);
  const running = view.director.status === "running" || Boolean(room.pendingAction);

  return (
    <div className="world-screen page-enter">
      <header className="world-screen-header">
        <div>
          <p className="eyebrow">世界任务</p>
          <h1>正在发生的事</h1>
          <p>把剧情章节看成当前世界里的长期计划，不提前替角色写完结局。</p>
        </div>
        <div className="world-screen-actions">
          <span className={`runtime-status runtime-${view.world.status}`}>{worldStatusLabel(view.world.status)}</span>
          <button className="button button-quiet" onClick={() => void room.requestProgression()} disabled={running || view.world.status !== "running"}>
            {running ? <LoaderCircle className="is-spinning" size={15} /> : <RefreshCw size={15} />}
            继续观察
          </button>
        </div>
      </header>

      <section className="world-task-summary" aria-label="任务概览">
        <SummaryItem label="进行中" value={String(chapters.filter((chapter) => chapter.status === "active").length)} tone="active" />
        <SummaryItem label="待开始" value={String(chapters.filter((chapter) => chapter.status === "queued").length)} tone="queued" />
        <SummaryItem label="已完成" value={String(chapters.filter((chapter) => chapter.status === "completed").length)} tone="resolved" />
        <SummaryItem label="已记录节点" value={String(view.narrative.beats.length)} tone="neutral" />
      </section>

      <section className="world-task-list">
        {chapters.length === 0 ? (
          <div className="world-empty-state">
            <GitBranch size={22} />
            <strong>还没有形成剧情任务</strong>
            <span>开始世界后，导演会把真正发生的冲突和目标整理成章节。</span>
            <Link className="button button-primary" to={chatPath}>回到现场</Link>
          </div>
        ) : chapters.map((chapter) => (
          <TaskRow key={chapter.id} chapter={chapter} chatPath={withContext(base, searchParams, chapter.contextIds[0] ?? view.contexts[0]?.id)} />
        ))}
      </section>
    </div>
  );
}

function TaskRow({ chapter, chatPath }: { chapter: WorldView["narrative"]["chapters"][number]; chatPath: string }) {
  const stateIcon = chapter.status === "completed"
    ? <CheckCircle2 size={18} />
    : chapter.status === "queued"
      ? <CalendarClock size={18} />
      : <Circle size={18} />;
  return (
    <article className={`world-task-row is-${chapter.status}`}>
      <span className="world-task-state">{stateIcon}</span>
      <div className="world-task-copy">
        <div className="world-task-heading">
          <h2>{chapter.title}</h2>
          <span>{chapterStatusLabel(chapter.status)}</span>
        </div>
        <p>{chapter.targetOutcome}</p>
        <small>{chapter.beatIds.length} 个剧情节点</small>
      </div>
      <Link className="button button-quiet" to={chatPath}>查看现场 <ArrowLeft size={14} /></Link>
    </article>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`world-task-summary-item is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function withContext(base: string, searchParams: URLSearchParams, contextId?: string): string {
  const next = new URLSearchParams(searchParams);
  if (contextId) next.set("context", contextId);
  const query = next.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

function chapterStatusLabel(status: WorldView["narrative"]["chapters"][number]["status"]): string {
  return status === "active" ? "进行中" : status === "queued" ? "待开始" : status === "abandoned" ? "已放弃" : "已完成";
}

function worldStatusLabel(status: WorldView["world"]["status"]): string {
  return status === "running" ? "世界运行中" : status === "paused" ? "已暂停" : status === "stopped" ? "已停止" : "等待开始";
}
