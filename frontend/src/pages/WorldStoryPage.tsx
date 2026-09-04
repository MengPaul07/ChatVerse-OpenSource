import { ArrowLeft, GitBranch, Link2, Sparkles } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useWorldRoomContext } from "../world/WorldRoomContext";

export default function WorldStoryPage() {
  const { worldId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const room = useWorldRoomContext();
  const view = room.state.view;
  if (!view) return null;

  const base = `/worlds/${encodeURIComponent(worldId)}`;
  const chatPath = `${base}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const beatById = new Map(view.narrative.beats.map((beat) => [beat.id, beat]));
  const edgeCountByBeat = new Map<string, number>();
  view.narrative.edges.forEach((edge) => {
    edgeCountByBeat.set(edge.fromBeatId, (edgeCountByBeat.get(edge.fromBeatId) ?? 0) + 1);
    edgeCountByBeat.set(edge.toBeatId, (edgeCountByBeat.get(edge.toBeatId) ?? 0) + 1);
  });

  return (
    <div className="world-screen page-enter">
      <header className="world-screen-header">
        <div>
          <p className="eyebrow">剧情图</p>
          <h1>世界正在怎样改变</h1>
          <p>节点是已经发生的关键事实，连线记录它们之间的因果，不是预写好的路线图。</p>
        </div>
        <Link className="button button-quiet" to={chatPath}><ArrowLeft size={15} />回到现场</Link>
      </header>

      <section className="world-story-layout">
        <aside className="world-story-chapters">
          <div className="world-section-label"><GitBranch size={16} />剧情章节</div>
          {view.narrative.chapters.length === 0 ? <p className="world-muted">故事还没有形成章节。</p> : view.narrative.chapters.map((chapter) => (
            <article className="world-story-chapter" key={chapter.id}>
              <span className={`chapter-state is-${chapter.status}`} />
              <div><strong>{chapter.title}</strong><small>{chapter.beatIds.length} 个节点 · {chapterStatusLabel(chapter.status)}</small></div>
              <p>{chapter.targetOutcome}</p>
            </article>
          ))}
        </aside>

        <section className="world-story-canvas" aria-label="剧情节点图">
          <div className="world-story-canvas-head">
            <div><span className="eyebrow">已提交事实</span><strong>{view.narrative.beats.length} 个节点</strong></div>
            <span><Link2 size={14} />{view.narrative.edges.length} 条关系</span>
          </div>
          {view.narrative.beats.length === 0 ? (
            <div className="world-empty-state"><Sparkles size={22} /><strong>剧情图等待第一个节点</strong><span>当导演判断出现真正的剧情变化后，这里会留下可追溯的节点。</span></div>
          ) : (
            <div className="world-story-node-grid">
              {view.narrative.beats.map((beat, index) => (
                <article className={`world-story-node${index === view.narrative.beats.length - 1 ? " is-latest" : ""}`} key={beat.id}>
                  <div className="world-story-node-mark">{index + 1}</div>
                  <div className="world-story-node-copy">
                    <span>{formatTime(beat.occurredAt)}</span>
                    <h2>{beat.title}</h2>
                    <p>{beat.outcome ?? beat.brief}</p>
                    <small>{edgeCountByBeat.get(beat.id) ?? 0} 条关联 · {beat.sourceEventIds.length} 个来源事件</small>
                  </div>
                </article>
              ))}
            </div>
          )}
          {view.narrative.edges.length > 0 && (
            <div className="world-story-edge-list">
              {view.narrative.edges.slice(-8).map((edge) => (
                <div key={edge.id}><span>{beatById.get(edge.fromBeatId)?.title ?? edge.fromBeatId}</span><b>{edge.type}</b><span>{beatById.get(edge.toBeatId)?.title ?? edge.toBeatId}</span></div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function chapterStatusLabel(status: "queued" | "active" | "completed" | "abandoned"): string {
  return status === "active" ? "进行中" : status === "queued" ? "待开始" : status === "abandoned" ? "已放弃" : "已完成";
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
}
