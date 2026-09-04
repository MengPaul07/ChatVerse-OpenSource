import type { FormEvent } from "react";
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  Globe2,
  LoaderCircle,
  Send,
  WandSparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  WorldAuthoringPlan,
  WorldAuthoringSessionEvent,
  WorldAuthoringTask,
  WorldDraft,
} from "@chatverse/world-authoring";
import type { AuthoringSessionView } from "../api/contracts";
import ArchitectSessionLog from "./ArchitectSessionLog";
import { Markdown } from "./StudioPrimitives";

type ResearchSource = NonNullable<WorldDraft["researchSources"]>[number];
type ResearchStatus = "idle" | "searching" | "completed" | "failed";

const AUTHORING_STARTERS = [
  {
    title: "雨夜便利店",
    description: "一间不打烊的小店，客人都藏着不愿说的秘密。",
    instruction: "创建一个雨夜便利店世界：一间不打烊的小店收留着几位各怀秘密的客人，故事从停电的夜晚开始。",
  },
  {
    title: "漂流的列车",
    description: "列车驶过没有地图记录的海面，每一站都改变一个人的记忆。",
    instruction: "创建一个漂流列车世界：列车在没有地图记录的海面上行驶，每一站都会改变一个人的记忆，故事从主角醒来开始。",
  },
  {
    title: "故障档案馆",
    description: "被删掉的历史在深夜重新亮起，等待有人读完。",
    instruction: "创建一个故障档案馆世界：被删除的历史会在深夜重新出现，几名值夜人必须决定哪些记录可以被带回现实。",
  },
] as const;

export interface ArchitectPanelProps {
  session: AuthoringSessionView;
  liveMarkdown: string;
  agentStatusText: string;
  sessionEvents: WorldAuthoringSessionEvent[];
  researchStatus: ResearchStatus;
  researchQuery: string;
  researchSourceCount: number;
  researchSources: ResearchSource[];
  busy?: string;
  instruction: string;
  sessionLogOpen: boolean;
  planOpen: boolean;
  showResearchSources: boolean;
  onInstructionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onToggleSessionLog: () => void | Promise<void>;
  onTogglePlan: () => void;
  onTaskAction: (action: "pause" | "resume") => void | Promise<void>;
  onToggleResearch: () => void | Promise<void>;
  onToggleResearchSources: () => void;
}

export default function ArchitectPanel({
  session,
  liveMarkdown,
  agentStatusText,
  sessionEvents,
  researchStatus,
  researchQuery,
  researchSourceCount,
  researchSources,
  busy,
  instruction,
  sessionLogOpen,
  planOpen,
  showResearchSources,
  onInstructionChange,
  onSubmit,
  onToggleSessionLog,
  onTogglePlan,
  onTaskAction,
  onToggleResearch,
  onToggleResearchSources,
}: ArchitectPanelProps) {
  const task = session.task;

  return (
    <aside className="architect-panel">
      <header className="architect-heading">
        <span><WandSparkles size={17} /></span>
        <div><strong>创作助手</strong><small>{session.status === "running" ? "正在理解你的想法…" : task ? `长期任务 · ${taskStatusCopy(task.status)}` : "你的创作副驾驶"}</small></div>
        <button
          className={`architect-log-toggle${sessionLogOpen ? " is-active" : ""}`}
          type="button"
          onClick={() => void onToggleSessionLog()}
          title={sessionLogOpen ? "返回创作对话" : "查看 Harness Session Log"}
          aria-pressed={sessionLogOpen}
        >
          <Activity size={14} />
          <span>{sessionLogOpen ? "对话" : "日志"}</span>
        </button>
      </header>
      {sessionLogOpen ? (
        <ArchitectSessionLog
          events={sessionEvents}
          harness={session.harness}
          running={session.status === "running"}
        />
      ) : <div className="architect-conversation">
        {session.plan && (
          <section className={`architect-plan${planOpen ? " is-open" : ""}`}>
            <button
              className="architect-plan-summary"
              type="button"
              onClick={onTogglePlan}
              aria-expanded={planOpen}
            >
              <span>
                <strong>创作计划</strong>
                <small>{session.plan.items.filter((item) => item.status === "completed").length}/{session.plan.items.length} 已完成</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {planOpen && (
              <div className="architect-plan-details">
                <p>{session.plan.goal}</p>
                <div className={`architect-task${task ? ` is-${task.status}` : ""}`}>
                  <div>
                    <strong>{task ? "长期创作任务" : "阶段式创作"}</strong>
                    <small>{task ? `${task.roundsStarted}/${task.maxRounds} 轮 · ${taskStatusCopy(task.status)}` : "计划生成后自动执行"}</small>
                  </div>
                  {task?.status === "active" ? (
                    <button className="button button-quiet" type="button" onClick={() => void onTaskAction("pause")} disabled={Boolean(busy)}>
                      暂停
                    </button>
                  ) : task?.status === "paused" ? (
                    <button className="button button-quiet" type="button" onClick={() => void onTaskAction("resume")} disabled={Boolean(busy)}>
                      恢复
                    </button>
                  ) : null}
                </div>
                {task?.lastError && <p className="architect-task-error">{task.lastError}</p>}
                <ol>
                  {session.plan.items.map((item) => (
                    <li className={`is-${item.status}`} key={item.id}>
                      <span>{item.status === "completed" ? <Check size={12} /> : null}</span>
                      <div>
                        <strong>{item.title}</strong>
                        <small>{planStatusCopy(item.status)}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        )}
        {session.conversation.length === 0 && (
          <div className="architect-welcome">
            <Bot size={21} />
            <strong>从一句想法开始</strong>
            <p>描述你想进入的世界、人物或冲突。我会直接把有效修改写入草稿，并按需要继续完成后续阶段。</p>
            <div className="architect-starters" aria-label="创作灵感">
              {AUTHORING_STARTERS.map((starter) => (
                <button
                  className="architect-starter"
                  key={starter.title}
                  type="button"
                  onClick={() => onInstructionChange(starter.instruction)}
                >
                  <strong>{starter.title}</strong>
                  <span>{starter.description}</span>
                </button>
              ))}
            </div>
            <button onClick={() => onInstructionChange("创建一个")} className="architect-seed">我有自己的想法</button>
          </div>
        )}
        {session.conversation.map((entry) => (
          <div className={`architect-message is-${entry.role}`} key={entry.id}>
            <span>{entry.role === "assistant" ? "Architect" : "你"}</span>
            {entry.role === "assistant"
              ? <Markdown content={entry.content} />
              : <p>{entry.content}</p>}
          </div>
        ))}
        {session.status === "running" && liveMarkdown && (
          <div className="architect-message is-assistant is-streaming">
            <span>Architect · 正在输出</span>
            <Markdown content={liveMarkdown} />
          </div>
        )}
        {session.status === "running" && !liveMarkdown && (
          <div className="architect-thinking">
            <LoaderCircle className="is-spinning" size={15} />
            {agentStatusText || "正在检查角色、关系和开场结构"}
          </div>
        )}
      </div>}

      <form className="architect-composer" onSubmit={(event) => void onSubmit(event)}>
        <div className="architect-research-bar">
          <button
            className={`architect-research-toggle${session.research.enabled ? " is-enabled" : ""}`}
            type="button"
            onClick={() => void onToggleResearch()}
            disabled={!session.research.available || Boolean(busy)}
            title={session.research.available ? "切换联网创作" : "请先在模型设置中配置并测试联网创作模型"}
            aria-pressed={session.research.enabled}
          >
            <Globe2 size={14} />
            <span>联网创作</span>
            <i aria-hidden="true" />
          </button>
          {!session.research.available && (
            <small className="architect-research-unavailable">
              <span>联网模型未就绪</span>
              <Link to="/settings/models">去配置</Link>
            </small>
          )}
          {session.research.enabled && researchStatus === "searching" && (
            <small className="is-searching">正在搜索：{researchQuery}</small>
          )}
          {session.research.enabled && researchStatus === "completed" && (
            <button
              className="architect-research-sources-trigger"
              type="button"
              onClick={onToggleResearchSources}
            >
              已参考 {researchSourceCount || researchSources.length} 个来源
            </button>
          )}
          {session.research.enabled && researchStatus === "failed" && <small className="is-failed">搜索失败，可继续创作</small>}
        </div>
        {showResearchSources && researchSources.length > 0 && (
          <div className="architect-research-sources">
            {researchSources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                <strong>{source.title || source.url}</strong>
                <span>{source.note || new URL(source.url).hostname}</span>
              </a>
            ))}
          </div>
        )}
        <textarea
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
          placeholder="例如：让世界更克制，加入一个知道部分真相的守门人"
          disabled={Boolean(busy)}
          rows={3}
        />
        <button className="icon-button" type="submit" disabled={!instruction.trim() || Boolean(busy)} title="发送" aria-label="发送">
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}

function planStatusCopy(status: WorldAuthoringPlan["items"][number]["status"]): string {
  switch (status) {
    case "pending": return "等待执行";
    case "in_progress": return "正在创作";
    case "awaiting_review": return "已应用";
    case "completed": return "已完成";
    case "skipped": return "已跳过";
  }
}

function taskStatusCopy(status: WorldAuthoringTask["status"]): string {
  switch (status) {
    case "active": return "自动执行中";
    case "paused": return "已暂停";
    case "waiting_user": return "等待你的指令";
    case "blocked": return "需要修正";
    case "completed": return "已完成";
  }
}
