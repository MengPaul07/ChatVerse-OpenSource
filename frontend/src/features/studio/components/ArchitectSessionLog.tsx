import { Activity, LoaderCircle, Wrench } from "lucide-react";
import type { WorldAuthoringHarnessState, WorldAuthoringSessionEvent } from "@chatverse/world-authoring";
import {
  authoringEventDetail,
  authoringEventTitle,
  authoringEventTone,
  formatCompactNumber,
  harnessStopReasonCopy,
} from "../session/eventLog";

export default function ArchitectSessionLog({ events, harness, running }: {
  events: WorldAuthoringSessionEvent[];
  harness: WorldAuthoringHarnessState;
  running: boolean;
}) {
  return (
    <section className="architect-session-log" aria-label="Studio Harness Session Log">
      <div className="architect-log-summary">
        <div><strong>{harness.turnCount}</strong><span>Turns</span></div>
        <div><strong>{harness.modelRequestCount}</strong><span>模型调用</span></div>
        <div><strong>{harness.toolCallCount}</strong><span>工具</span></div>
        <div><strong>{formatCompactNumber(harness.totalTokens)}</strong><span>Tokens</span></div>
      </div>
      <div className="architect-log-caption">
        <span className={running ? "is-running" : ""}>
          {running ? <LoaderCircle className="is-spinning" size={12} /> : <Activity size={12} />}
          {running ? "Harness 正在执行" : `上次结束：${harnessStopReasonCopy(harness.lastStopReason)}`}
        </span>
        <small>仅展示执行轨迹，不展示模型隐藏推理</small>
      </div>
      <div className="architect-log-events">
        {events.length === 0 ? (
          <div className="architect-log-empty"><Activity size={18} /><span>发送创作要求后，这里会记录每个 Turn、Step 和工具 Observation。</span></div>
        ) : events.map((event) => (
          <article className={`architect-log-event is-${authoringEventTone(event)}`} key={event.sequence}>
            <span className="architect-log-sequence">#{event.sequence}</span>
            <span className="architect-log-icon">{event.type.startsWith("tool.") ? <Wrench size={11} /> : <Activity size={11} />}</span>
            <div><strong>{authoringEventTitle(event)}</strong><p>{authoringEventDetail(event)}</p></div>
            <time>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
          </article>
        ))}
      </div>
    </section>
  );
}
