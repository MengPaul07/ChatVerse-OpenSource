import {
  ArrowRight,
  Bot,
  Boxes,
  BriefcaseBusiness,
  Check,
  CircleUserRound,
  FileCheck2,
  FileText,
  GitBranch,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Network,
  Orbit,
  PanelTop,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";

const principles = [
  {
    icon: Layers3,
    index: "01",
    title: "状态，而非一次性答案",
    text: "让作品、上下文与决策持续存在。每一次生成都发生在明确状态之上，而不是重新开始。",
  },
  {
    icon: ScanSearch,
    index: "02",
    title: "过程可见，也可修正",
    text: "把 Agent 的行动、结果与用量放回用户视野。关键修改有记录，重要决定能追溯。",
  },
  {
    icon: LockKeyhole,
    index: "03",
    title: "数据边界由用户掌握",
    text: "优先采用本地持久化和用户自有模型连接，减少不必要的上传、留存与平台锁定。",
  },
];

export default function CorporateHomePage() {
  return (
    <div className="corporate-page">
      <header className="corporate-nav">
        <a className="corporate-brand" href="#top" aria-label="ChatVerse 首页">
          <img src="/chatverse-mark-v2.svg" alt="" />
          <span><strong>ChatVerse</strong><small>AI PRODUCT STUDIO</small></span>
        </a>
        <nav aria-label="页面导航">
          <a href="#products">产品</a>
          <a href="#principles">产品原则</a>
          <a href="#engineering">工程能力</a>
          <a className="corporate-nav-cta" href="https://world.chatverse.fun/">进入 World <ArrowRight size={15} /></a>
        </nav>
      </header>

      <main id="top">
        <section className="corporate-hero">
          <div className="corporate-hero-copy">
            <p className="corporate-kicker"><span /> INDEPENDENT AI PRODUCTS · BEIJING</p>
            <h1>让复杂工作，拥有<br /><em>可持续运行的智能。</em></h1>
            <p className="corporate-lede">ChatVerse 构建面向真实创作与职业任务的 AI 原生产品。我们关心的不只是生成一次答案，而是让上下文、决策与结果在一个可靠的工作空间里持续演进。</p>
            <div className="corporate-hero-actions">
              <a className="corporate-button primary" href="#products">查看产品 <ArrowRight size={17} /></a>
              <a className="corporate-button secondary" href="#principles">了解产品原则</a>
            </div>
          </div>

          <div className="corporate-hero-system" aria-label="ChatVerse 产品系统">
            <div className="corporate-system-head"><span>PRODUCT SYSTEM</span><span>02 / LIVE</span></div>
            <div className="corporate-system-core">
              <span className="corporate-core-ring ring-one" />
              <span className="corporate-core-ring ring-two" />
              <span className="corporate-core-node node-one" />
              <span className="corporate-core-node node-two" />
              <span className="corporate-core-node node-three" />
              <span className="corporate-core-node node-four" />
              <img src="/chatverse-mark-v2.svg" alt="ChatVerse" />
            </div>
            <div className="corporate-system-products">
              <a href="https://world.chatverse.fun/"><Orbit size={18} /><span><strong>World</strong><small>智能体世界编排</small></span><ArrowRight size={15} /></a>
              <a href="https://job.chatverse.fun/"><BriefcaseBusiness size={18} /><span><strong>Job</strong><small>AI 原生求职工作台</small></span><ArrowRight size={15} /></a>
            </div>
            <div className="corporate-system-foot"><ShieldCheck size={14} /> LOCAL-FIRST · USER-CONTROLLED</div>
          </div>
        </section>

        <section className="corporate-proof" aria-label="产品能力概览">
          <div><strong>02</strong><span>在线产品</span></div>
          <div><strong>LOCAL</strong><span>浏览器端作品持久化</span></div>
          <div><strong>TRACE</strong><span>结构化 Agent 操作记录</span></div>
          <div><strong>BYOK</strong><span>用户自有模型连接</span></div>
        </section>

        <section className="corporate-products corporate-section" id="products">
          <header className="corporate-section-heading">
            <div><p>PRODUCTS / 01</p><h2>两条产品线，一个共同方向。</h2></div>
            <span>把 AI 从对话框带进可持续工作的产品系统。</span>
          </header>

          <article className="corporate-product corporate-product-world">
            <div className="corporate-product-copy">
              <div className="corporate-product-label"><Orbit size={18} /><span>CHATVERSE WORLD</span><em>在线产品</em></div>
              <h3>让角色、关系与剧情，<br />在一个世界里真正运行。</h3>
              <p>事件驱动的 AI 世界创作与编排工具。World Director 规划剧情，Narrator 维持场景，Actor 依据自己的认知与关系自主行动。</p>
              <ul>
                <li><Check size={14} />一句设定到可编辑 World</li>
                <li><Check size={14} />角色认知隔离与长期记忆</li>
                <li><Check size={14} />Galgame 舞台与玩家关键选择</li>
              </ul>
              <div className="corporate-product-actions">
                <a className="corporate-button primary" href="https://world.chatverse.fun/">打开 World <ArrowRight size={16} /></a>
                <a className="corporate-inline-link" href="https://world.chatverse.fun/showcase">查看编排展示 <span>↗</span></a>
              </div>
            </div>

            <div className="world-product-visual" aria-label="World 产品界面示意">
              <div className="product-window-bar"><span /><span /><span /><strong>凌晨档案室 · 世界运行</strong><em>RUNNING</em></div>
              <div className="world-window-body">
                <aside>
                  <span className="mock-nav-active"><PanelTop size={14} />世界现场</span>
                  <span><Waypoints size={14} />剧情图</span>
                  <span><CircleUserRound size={14} />角色状态</span>
                  <span><FileText size={14} />事件记录</span>
                </aside>
                <div className="world-event-stream">
                  <div className="mock-context"><span>SCENE · 00:17</span><strong>地下一层档案室</strong><small>一份日期来自明天的失踪记录，刚刚出现在柜子里。</small></div>
                  <div className="mock-event narrator"><i>N</i><span><small>NARRATOR</small><strong>自动归档柜发出完成提示。走廊尽头的门禁灯忽然亮起。</strong></span></div>
                  <div className="mock-event actor"><i>林</i><span><small>林见夏 · ACTOR</small><strong>“先别碰封条。这个编号今天下午还不存在。”</strong></span></div>
                  <div className="mock-decision"><small>PLAYER TURN</small><div><span>先检查门禁记录</span><span>询问档案的来源</span></div></div>
                </div>
                <div className="world-state-panel">
                  <span>WORLD STATE</span>
                  <dl><dt>活跃角色</dt><dd>3</dd><dt>开放章节</dt><dd>2</dd><dt>已提交事件</dt><dd>18</dd></dl>
                  <div className="mock-graph"><i /><i /><i /><i /><b /><b /></div>
                  <small>因果图已更新</small>
                </div>
              </div>
            </div>
          </article>

          <article className="corporate-product corporate-product-job">
            <div className="job-product-visual" aria-label="Job 产品界面示意">
              <div className="product-window-bar light"><span /><span /><span /><strong>Resume Studio · AI Tailor</strong><em>LOCAL</em></div>
              <div className="job-window-body">
                <aside>
                  <div className="job-profile"><i>MP</i><span><strong>目标岗位</strong><small>AI 产品经理</small></span></div>
                  <nav><span className="active"><Sparkles size={14} />AI 优化</span><span><FileText size={14} />简历排版</span><span><BriefcaseBusiness size={14} />岗位描述</span><span><MessageSquareText size={14} />模拟面试</span></nav>
                  <div className="job-match"><small>JD MATCH</small><strong>86<sup>%</sup></strong><span><i /></span><em>较上一版 +14%</em></div>
                </aside>
                <div className="job-chat">
                  <div className="job-chat-head"><span>对话式修改</span><em>3 项更改待确认</em></div>
                  <div className="job-message user">把最近一段项目经历改得更适合这个岗位。</div>
                  <div className="job-message ai"><Bot size={15} /><span>我会先核对 JD 的核心要求，再重写工作成果。事实与数字不会被擅自补充。</span></div>
                  <div className="job-tool-call"><GitBranch size={14} /><span><small>UPDATE_FIELD</small><strong>工作经历 / 项目成果</strong></span><Check size={14} /></div>
                  <div className="job-suggestion"><small>建议修改</small><strong>将产品设计与模型评测流程整合为可交付方案，推动 3 个关键场景进入真实用户验证。</strong><div><span>保留原文</span><b>应用更改</b></div></div>
                </div>
                <div className="job-resume-preview">
                  <div className="resume-paper"><h4>MENG PAUL</h4><p>AI PRODUCT MANAGER</p><hr /><strong>EXPERIENCE</strong><span /><span /><span className="short" /><strong>SELECTED PROJECTS</strong><span /><span /><span /></div>
                  <small>实时排版预览 · A4</small>
                </div>
              </div>
            </div>

            <div className="corporate-product-copy">
              <div className="corporate-product-label"><BriefcaseBusiness size={18} /><span>CHATVERSE JOB</span><em>在线产品</em></div>
              <h3>从简历到面试，<br />把求职变成连续工作流。</h3>
              <p>AI 原生简历工作室。导入、对话式编辑、JD 定向优化、可视化排版与模拟面试都围绕同一份结构化简历持续协作。</p>
              <ul>
                <li><Check size={14} />PDF / DOCX 结构化导入</li>
                <li><Check size={14} />Agent 精准修改与变更确认</li>
                <li><Check size={14} />JD 对齐、排版与面试演练</li>
              </ul>
              <div className="corporate-product-actions">
                <a className="corporate-button job-primary" href="https://job.chatverse.fun/">打开 Job <ArrowRight size={16} /></a>
              </div>
            </div>
          </article>
        </section>

        <section className="corporate-principles corporate-section" id="principles">
          <header className="corporate-section-heading inverse">
            <div><p>PRINCIPLES / 02</p><h2>AI 产品，也应该有清晰边界。</h2></div>
            <span>我们用产品结构减少不确定性，而不是把所有责任交给模型。</span>
          </header>
          <div className="corporate-principle-grid">
            {principles.map(({ icon: Icon, index, title, text }) => (
              <article key={index}>
                <div><Icon size={20} /><span>{index}</span></div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="corporate-engineering corporate-section" id="engineering">
          <div className="corporate-engineering-copy">
            <p>ENGINEERING / 03</p>
            <h2>从模型能力，<br />到可以交付的产品能力。</h2>
            <p>ChatVerse 的两个产品都建立在同一套工程判断上：状态需要持久化，操作需要结构化，运行需要可观察，成本需要可度量。</p>
            <a className="corporate-inline-link dark" href="https://world.chatverse.fun/docs">阅读 World 技术文档 <span>↗</span></a>
          </div>
          <div className="corporate-capability-list">
            <article><Network size={19} /><div><strong>Agent Orchestration</strong><span>通过明确角色、工具与状态边界组织复杂任务。</span></div><em>01</em></article>
            <article><Boxes size={19} /><div><strong>Structured Operations</strong><span>让模型作用于可验证的数据结构，而不是不可控的整段文本。</span></div><em>02</em></article>
            <article><FileCheck2 size={19} /><div><strong>Quality &amp; Evaluation</strong><span>用回归测试、长程运行与预算门槛验证真实质量。</span></div><em>03</em></article>
            <article><ShieldCheck size={19} /><div><strong>Privacy by Architecture</strong><span>本地优先、按需处理，减少作品和职业数据暴露。</span></div><em>04</em></article>
          </div>
        </section>

        <section className="corporate-closing">
          <div>
            <p>CHOOSE A WORKSPACE</p>
            <h2>从一个真实任务开始。</h2>
            <span>进入独立产品，开始创建世界或整理下一次职业机会。</span>
          </div>
          <div className="corporate-closing-actions">
            <a href="https://world.chatverse.fun/"><Orbit size={20} /><span><strong>ChatVerse World</strong><small>创建并运行智能体世界</small></span><ArrowRight size={18} /></a>
            <a href="https://job.chatverse.fun/"><BriefcaseBusiness size={20} /><span><strong>ChatVerse Job</strong><small>构建简历与面试工作流</small></span><ArrowRight size={18} /></a>
          </div>
        </section>
      </main>

      <footer className="corporate-footer">
        <div className="corporate-footer-brand"><img src="/chatverse-mark-v2.svg" alt="" /><span><strong>ChatVerse</strong><small>Independent AI Product Studio</small></span></div>
        <p>构建有状态、可观察、由用户掌控的 AI 原生产品。</p>
        <nav aria-label="页脚导航">
          <a href="https://world.chatverse.fun/">World</a>
          <a href="https://job.chatverse.fun/">Job</a>
          <a href="https://world.chatverse.fun/docs">文档</a>
          <a href="/privacy">隐私政策</a>
          <a href="/terms">用户协议</a>
        </nav>
        <div className="corporate-records">
          <span>© 2026 ChatVerse</span>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">京ICP备2026048747号</a>
          <a href="https://beian.mps.gov.cn/#/query/webSearch?code=11011702000641" target="_blank" rel="noreferrer">京公网安备11011702000641号</a>
        </div>
      </footer>
    </div>
  );
}
