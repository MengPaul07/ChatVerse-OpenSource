import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  BookOpen,
  Check,
  Clock3,
  GitBranch,
  MessageSquareText,
  Radio,
  ScanSearch,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { Link } from "react-router-dom";
import { SHOWCASE_PRESET, type ShowcaseStep, type ShowcaseStepKind } from "../showcase";
import { useSiteMode } from "../siteMode";

const STEP_INTERVAL_MS = 1900;
const LOOP_PAUSE_MS = 2600;

export default function ShowcasePage() {
  const siteMode = useSiteMode();
  const isPortalRoute = siteMode === "portal";
  const isServerShowcase = siteMode === "showcase";
  const canOpenRuntime = siteMode === "full";
  const [visibleCount, setVisibleCount] = useState(1);
  const steps = SHOWCASE_PRESET.steps;
  const isComplete = visibleCount >= steps.length;
  const visibleSteps = useMemo(() => steps.slice(0, visibleCount), [steps, visibleCount]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisibleCount((current) => current >= steps.length ? 1 : Math.min(current + 1, steps.length));
    }, isComplete ? LOOP_PAUSE_MS : STEP_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [isComplete, steps.length, visibleCount]);

  return (
    <div className="showcase-page page-enter">
      <header className="showcase-topbar">
        {isServerShowcase
          ? <div className="showcase-back is-static"><GitBranch size={16} /><span>智能体编排展示</span></div>
          : <Link className="showcase-back" to="/"><ArrowLeft size={16} /><span>{isPortalRoute ? "返回 ChatVerse" : "回到探索"}</span></Link>}
        <div className="showcase-topbar-title">
          <GitBranch size={16} />
          <strong>智能体编排展示</strong>
        </div>
        <div className="showcase-topbar-actions">
          <span className="showcase-static-badge"><span />循环播放 · 公开展示</span>
          <Link className="button button-quiet" to="/docs"><BookOpen size={15} />阅读文档</Link>
          {canOpenRuntime && <Link className="button button-quiet" to="/settings/models"><ArrowRight size={15} />填写 Key 后运行</Link>}
        </div>
      </header>

      <main className="showcase-main">
        <section className="showcase-intro">
          <div>
            <p className="eyebrow">CHATVERSE · PERSONAL AGENT SPACE</p>
            <h1>一次世界事件，如何被编排成故事。</h1>
            <p className="showcase-lede">这是一个不连接实时模型的固定流程预设，用来展示 ChatVerse 的核心工作方式：世界负责事实，Director 负责宏观编排，角色负责自己的反应。</p>
          </div>
          <div className="showcase-intro-aside">
            <span className="showcase-mark"><Radio size={17} /></span>
            <strong>{SHOWCASE_PRESET.note}</strong>
            <span>不接受输入 · 不创建房间 · 不写入本地世界库</span>
          </div>
        </section>

        <section className="showcase-pipeline" aria-label="编排流程">
          <div className="showcase-section-heading">
            <div><p className="eyebrow">PIPELINE</p><h2>从事实到剧情节点</h2></div>
            <span>循环播放 · {visibleCount} / {steps.length}</span>
          </div>
          <div className="showcase-pipeline-track">
            {steps.map((step, index) => (
              <div className={`showcase-pipeline-node ${index < visibleCount ? "is-visible" : ""}`} key={step.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{pipelineLabel(step.kind)}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="showcase-layout">
          <section className="showcase-flow-panel" aria-label="静态运行记录" aria-live="polite">
            <div className="showcase-panel-heading">
              <div><p className="eyebrow">RUN LOG · PRESET</p><h2>{SHOWCASE_PRESET.name}</h2><span>{SHOWCASE_PRESET.scene}</span></div>
              <span className="showcase-running-status"><span />{isComplete ? "流程已完成" : "按阶段展示"}</span>
            </div>
            <div className="showcase-flow-list">
              {visibleSteps.map((step) => <ShowcaseStepCard key={step.id} step={step} />)}
              {!isComplete && <div className="showcase-flow-wait"><span /><span /><span />下一阶段正在准备</div>}
            </div>
          </section>

          <aside className="showcase-side-column">
            <section className="showcase-side-card">
              <div className="showcase-card-heading"><ScanSearch size={16} /><strong>当前世界状态</strong></div>
              <div className="showcase-status-list">
                <StatusRow icon={Archive} label="当前场景" value="档案室 · 01:17" />
                <StatusRow icon={Bot} label="角色运行" value="2 名角色已唤醒" />
                <StatusRow icon={BrainCircuit} label="共享记忆" value="3 条事实待整理" />
                <StatusRow icon={Waypoints} label="剧情图" value="新增 1 个节点" />
              </div>
            </section>
            <section className="showcase-side-card showcase-principles">
              <div className="showcase-card-heading"><Sparkles size={16} /><strong>编排边界</strong></div>
              <ul>
                <li>Director 分配注意力，不替角色说话。</li>
                <li>旁白只描述可观察的事实和环境变化。</li>
                <li>剧情节点保留因果关系，后续推进可以连续追踪。</li>
              </ul>
            </section>
            <section className="showcase-side-card showcase-switch-card">
              <Clock3 size={16} />
              <div>
                <strong>这是公开展示流程</strong>
                <span>{isPortalRoute
                  ? "页面仅演示智能体编排机制；完整创作能力位于 World 产品。"
                  : "想实际体验角色对话，请先在设置中填写自己的模型 Key。"}</span>
              </div>
              {isPortalRoute
                ? <a className="text-link" href="https://world.chatverse.fun/">进入 World <ArrowRight size={14} /></a>
                : canOpenRuntime
                  ? <Link className="text-link" to="/settings/models">打开设置 <ArrowRight size={14} /></Link>
                  : null}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ShowcaseStepCard({ step }: { step: ShowcaseStep }) {
  const Icon = stepIcon(step.kind);
  return (
    <article className={`showcase-step-card accent-${step.accent}`}>
      <div className="showcase-step-icon"><Icon size={16} /></div>
      <div className="showcase-step-content">
        <div className="showcase-step-meta"><span>{step.phase}</span><code>{step.meta}</code></div>
        <h3>{step.title}</h3>
        <p className="showcase-step-actor">{step.actor}</p>
        <p className="showcase-step-text">{step.text}</p>
      </div>
      <Check className="showcase-step-check" size={15} />
    </article>
  );
}

function StatusRow({ icon: Icon, label, value }: { icon: typeof Archive; label: string; value: string }) {
  return <div className="showcase-status-row"><Icon size={15} /><span>{label}</span><strong>{value}</strong></div>;
}

function stepIcon(kind: ShowcaseStepKind) {
  switch (kind) {
    case "input": return MessageSquareText;
    case "director": return Bot;
    case "narration": return Radio;
    case "actor": return MessageSquareText;
    case "memory": return BrainCircuit;
    case "commit": return Waypoints;
  }
}

function pipelineLabel(kind: ShowcaseStepKind): string {
  switch (kind) {
    case "input": return "事件";
    case "director": return "编排";
    case "narration": return "事实";
    case "actor": return "角色";
    case "memory": return "记忆";
    case "commit": return "节点";
  }
}
