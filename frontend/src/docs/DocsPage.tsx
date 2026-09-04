import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  ExternalLink,
  FileText,
  GitBranch,
  Layers3,
  Search,
  Server,
  Terminal,
} from "lucide-react";
import { Link as RouterLink, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import {
  docCategoryLabels,
  docs,
  docsByCategory,
  findDoc,
  type DocCategory,
  type DocEntry,
} from "./docRegistry";

type Heading = { level: number; title: string; id: string };

const categoryOrder: DocCategory[] = ["start", "concepts", "reference", "notes"];

function headingId(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return normalized || "section";
}

function extractHeadings(content: string): Heading[] {
  return content
    .split("\n")
    .map((line) => line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ level: match[1].length, title: match[2].trim(), id: headingId(match[2]) }));
}

function displaySource(sourcePath: string) {
  return sourcePath.split("/").pop() ?? "document.md";
}

function DocsSidebar({ activeSlug, filter, onFilterChange }: { activeSlug?: string; filter: string; onFilterChange: (value: string) => void }) {
  const visibleDocs = docs.filter((doc) => `${doc.title} ${doc.description}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <aside className="docs-sidebar" aria-label="文档导航">
      <div className="docs-sidebar-label"><BookOpen size={14} /> 文档目录</div>
      <label className="docs-search">
        <Search size={15} aria-hidden="true" />
        <input value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="搜索文档" aria-label="搜索文档" />
        {filter ? <span className="docs-search-count">{visibleDocs.length}</span> : null}
      </label>
      <nav className="docs-sidebar-nav">
        {categoryOrder.map((category) => {
          const categoryDocs = docsByCategory(category).filter((doc) => visibleDocs.includes(doc));
          if (!categoryDocs.length) return null;
          return (
            <section className="docs-sidebar-section" key={category}>
              <h2>{docCategoryLabels[category]}</h2>
              {categoryDocs.map((doc) => (
                <RouterLink className={`docs-sidebar-link${doc.slug === activeSlug ? " is-active" : ""}`} key={doc.slug} to={`/docs/${doc.slug}`}>
                  <span>{doc.title}</span>
                  {doc.slug === activeSlug ? <ChevronRight size={13} aria-hidden="true" /> : null}
                </RouterLink>
              ))}
            </section>
          );
        })}
        {!visibleDocs.length ? <p className="docs-sidebar-empty">没有匹配的文档</p> : null}
      </nav>
      <div className="docs-sidebar-footnote">
        <span className="docs-status-dot" />
        <span>内容来自仓库 <code>docs/</code></span>
      </div>
    </aside>
  );
}

export default function DocsPage() {
  const { slug } = useParams();
  const [filter, setFilter] = useState("");
  const currentDoc = findDoc(slug);

  return (
    <div className="docs-page">
      <DocsSidebar activeSlug={slug} filter={filter} onFilterChange={setFilter} />
      <main className="docs-main">
        {!slug ? <DocsHome entries={docs} /> : currentDoc ? <DocsArticle doc={currentDoc} /> : <DocsNotFound />}
      </main>
    </div>
  );
}

function DocsHome({ entries }: { entries: DocEntry[] }) {
  const learningPath = entries.filter((entry) => entry.category !== "notes").slice(0, 4);

  return (
    <div className="docs-landing">
      <div className="docs-breadcrumb"><span>ChatVerse</span><ChevronRight size={13} /><strong>Documentation</strong></div>
      <section className="docs-hero">
        <div className="docs-hero-copy">
          <p className="docs-kicker">OPEN SOURCE WORLD RUNTIME</p>
          <h1>把一个世界，编排成可运行的对话。</h1>
          <p>ChatVerse 用 World、Actor、Context 和 Director 把多智能体故事组织成可以观察、调试和恢复的运行时。沿着这份文档，从第一个 World 开始。</p>
          <div className="docs-hero-actions">
            <RouterLink className="docs-primary-action" to="/docs/getting-started"><Terminal size={15} /> 5 分钟上手 <ArrowRight size={14} /></RouterLink>
            <RouterLink className="docs-secondary-action" to="/docs/api"><Code2 size={15} /> 浏览 API</RouterLink>
          </div>
        </div>
        <div className="docs-hero-signal" aria-hidden="true">
          <span className="docs-hero-signal-line" />
          <span className="docs-hero-signal-core">CV</span>
          <span className="docs-hero-signal-line" />
          <small>WORLD / RUNTIME / EVENT</small>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-section-heading">
          <div><p className="docs-kicker">01 / SYSTEM MAP</p><h2>先看懂它如何运行</h2></div>
          <p>一份图先建立全局，再进入代码细节。</p>
        </div>
        <ArchitectureDiagram />
      </section>

      <section className="docs-section">
        <div className="docs-section-heading">
          <div><p className="docs-kicker">02 / API SURFACE</p><h2>从输入到事件流</h2></div>
          <RouterLink className="docs-inline-link" to="/docs/api">打开完整参考 <ArrowRight size={14} /></RouterLink>
        </div>
        <ApiSurfaceMap />
      </section>

      <section className="docs-section">
        <div className="docs-section-heading">
          <div><p className="docs-kicker">03 / LEARNING PATH</p><h2>按这个顺序读，会更快</h2></div>
        </div>
        <div className="docs-learning-grid">
          {learningPath.map((entry, index) => (
            <RouterLink className="docs-learning-card" key={entry.slug} to={`/docs/${entry.slug}`}>
              <span className="docs-learning-number">0{index + 1}</span>
              <span className="docs-learning-copy"><strong>{entry.title}</strong><small>{entry.description}</small></span>
              <ArrowRight size={15} aria-hidden="true" />
            </RouterLink>
          ))}
        </div>
      </section>

      <section className="docs-section docs-source-panel">
        <div className="docs-source-icon"><GitBranch size={18} /></div>
        <div>
          <p className="docs-kicker">DOCS AS CODE</p>
          <h2>新增 Markdown，就会自动出现在这里</h2>
          <p>文档页直接读取仓库根目录的 <code>docs/*.md</code>。支持可选的 frontmatter（title、description、category、order），不用再改前端导航。</p>
        </div>
        <pre><code>{"---\ntitle: My new guide\ncategory: start\norder: 4\n---"}</code></pre>
      </section>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="docs-architecture-card">
      <div className="docs-architecture-flow">
        <div className="docs-architecture-node docs-architecture-node-definition"><Layers3 size={17} /><span><strong>WorldDefinition</strong><small>静态世界蓝图</small></span></div>
        <span className="docs-flow-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
        <div className="docs-architecture-node docs-architecture-node-runtime"><Server size={17} /><span><strong>World Runtime</strong><small>队列、状态、调度</small></span></div>
        <span className="docs-flow-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
        <div className="docs-architecture-node docs-architecture-node-director"><BookOpen size={17} /><span><strong>Director + Actors</strong><small>决定谁在何时说话</small></span></div>
        <span className="docs-flow-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
        <div className="docs-architecture-node docs-architecture-node-event"><GitBranch size={17} /><span><strong>Events / Snapshot</strong><small>可观察、可恢复</small></span></div>
      </div>
      <div className="docs-architecture-contexts"><span className="docs-architecture-context-dot" /><strong>Contexts</strong><span>群聊、私聊、任务和叙事视图共享同一份世界状态</span></div>
    </div>
  );
}

function ApiSurfaceMap() {
  return (
    <div className="docs-api-map">
      <div className="docs-api-map-column">
        <span className="docs-api-map-label">INPUT</span>
        <code>sendMessage()</code>
        <code>emitEvent()</code>
        <code>changeDirection()</code>
      </div>
      <div className="docs-api-map-connector"><span /><span /><span /></div>
      <div className="docs-api-map-core"><span className="docs-api-map-label">CORE</span><strong>ChatVerse</strong><small>World / Context / Director</small></div>
      <div className="docs-api-map-connector is-output"><span /><span /><span /></div>
      <div className="docs-api-map-column">
        <span className="docs-api-map-label">OUTPUT</span>
        <code>onEvent()</code>
        <code>snapshot()</code>
        <code>getContextMessages()</code>
      </div>
    </div>
  );
}

function DocsArticle({ doc }: { doc: DocEntry }) {
  const headings = useMemo(() => extractHeadings(doc.content), [doc.content]);

  return (
    <article className="docs-article">
      <div className="docs-breadcrumb"><RouterLink to="/docs">Documentation</RouterLink><ChevronRight size={13} /><strong>{doc.title}</strong></div>
      <header className="docs-article-header">
        <div>
          <span className="docs-article-category">{docCategoryLabels[doc.category]}</span>
          <h1>{doc.title}</h1>
          <p>{doc.description}</p>
        </div>
        <span className="docs-source-chip"><FileText size={14} /> {displaySource(doc.sourcePath)}</span>
      </header>
      {doc.slug === "api" ? <ApiSurfaceMap /> : null}
      <div className="docs-article-layout">
        <div className="docs-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{doc.content}</ReactMarkdown></div>
        <aside className="docs-toc" aria-label="本页目录">
          <strong>本页目录</strong>
          {headings.length ? headings.map((heading) => <a className={heading.level === 3 ? "is-sub" : ""} href={`#${heading.id}`} key={`${heading.id}-${heading.level}`}>{heading.title}</a>) : <span>这篇文档没有二级目录</span>}
        </aside>
      </div>
    </article>
  );
}

function DocsNotFound() {
  return (
    <div className="docs-not-found">
      <span className="docs-not-found-mark">404</span>
      <h1>这篇文档还不存在</h1>
      <p>检查 URL，或者从文档首页选择一篇已发布的 Markdown。</p>
      <RouterLink className="docs-primary-action" to="/docs">回到文档首页 <ArrowRight size={14} /></RouterLink>
    </div>
  );
}

function MarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
  const code = String(children ?? "").replace(/\n$/, "");
  const language = className?.replace("language-", "") || "code";
  const [copied, setCopied] = useState(false);

  if (!className) return <code className="docs-inline-code">{children}</code>;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="docs-code-block">
      <div className="docs-code-toolbar"><span><Code2 size={13} /> {language}</span><button type="button" onClick={copyCode}>{copied ? <Check size={13} /> : <Clipboard size={13} />} {copied ? "已复制" : "复制"}</button></div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1>{children}</h1>,
  h2: ({ children }) => {
    const title = String(children);
    return <h2 id={headingId(title)}>{children}</h2>;
  },
  h3: ({ children }) => {
    const title = String(children);
    return <h3 id={headingId(title)}>{children}</h3>;
  },
  code: ({ className, children }) => <MarkdownCode className={className} children={children} />,
  a: ({ href, children }) => {
    if (!href || href.startsWith("#")) return <a href={href}>{children}</a>;
    if (href.startsWith("http")) return <a href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={12} /></a>;
    const docSlug = href.replace(/^\.\//, "").replace(/\.md$/, "").toLowerCase();
    return <RouterLink to={docSlug.startsWith("docs/") ? `/${docSlug}` : `/docs/${docSlug}`}>{children}</RouterLink>;
  },
  blockquote: ({ children }) => <blockquote><span className="docs-blockquote-mark">“</span>{children}</blockquote>,
};
