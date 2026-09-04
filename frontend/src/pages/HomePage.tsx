import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Compass,
  FilePenLine,
  History,
  LibraryBig,
  LoaderCircle,
  MessageCircle,
  Play,
  Plus,
  Radio,
  Sparkles,
  UsersRound,
  Workflow,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useChatVerse } from "../app/ChatVerseContext";
import GuidedTour, { GuideLauncher, type GuidedTourStep } from "../components/GuidedTour";
import { WorldTemplateCover } from "../components/WorldTemplateCover";
import TemplateDuplicateDialog, { type TemplateDuplicateRequest } from "../components/TemplateDuplicateDialog";
import { completeOnboardingChapter, dismissOnboardingChapter, readOnboardingState } from "../onboarding";
import { latestWorldArchives, listWorldArchives, type WorldArchiveRecord } from "../worldArchiveLibrary";
import { listWorldDrafts, type WorldDraftRecord } from "../worldDraftLibrary";
import { findWorldTemplate, WORLD_TEMPLATE_PACKS, type WorldTemplatePack } from "../worldTemplateCatalog";
import { countWorldsFromTemplate, createDraftFromWorldTemplate, startWorldFromTemplate } from "../worldTemplateLauncher";
import { type WorldRuntimeEntry, useWorldRuntimeIndex } from "../worldRuntimeIndex";
import { groupWorldManagePath } from "../world/groupRoutes";

export default function HomePage() {
  const navigate = useNavigate();
  const { groups } = useChatVerse();
  const [archives, setArchives] = useState<WorldArchiveRecord[]>([]);
  const [drafts, setDrafts] = useState<WorldDraftRecord[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [error, setError] = useState<string>();
  const homeTemplates = useMemo(() => selectHomeTemplates(WORLD_TEMPLATE_PACKS), []);
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => homeTemplates[0]?.id ?? "");
  const [startingTemplateId, setStartingTemplateId] = useState<string | null>(null);
  const [installingTemplateId, setInstallingTemplateId] = useState<string | null>(null);
  const [duplicateRequest, setDuplicateRequest] = useState<TemplateDuplicateRequest>();
  const [guideOpen, setGuideOpen] = useState(() => readOnboardingState().chapters.home === "pending");
  const guideSteps = useMemo<GuidedTourStep[]>(() => [
    {
      target: "[data-guide='home-featured']",
      eyebrow: "世界航线 · 入口",
      title: "先从一个已经能运行的世界开始",
      description: "推荐世界已经带好角色、场景和运行规则。选择“准备进入”会建立一份只属于你的本地存档，不会改动原模板。",
    },
    {
      target: "[data-guide='home-discovery']",
      eyebrow: "世界航线 · 选择",
      title: "换故事，只是在浏览入口",
      description: "右侧列表可以预览不同体验。真正进入或基于模板创作之前，不会启动模型，也不会消耗剧情 Token。",
    },
    {
      target: "[data-guide='home-create']",
      eyebrow: "世界航线 · 创作",
      title: "也可以从一句设定开始",
      description: "“创造世界”会打开 Studio，把世界观、角色和运行方式整理成可启动的 World。第一次运行前，建议先接好文本模型。",
      actionLabel: "先配置模型",
      onAction: () => navigate("/settings/models"),
    },
  ], [navigate]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([listWorldArchives(), listWorldDrafts()])
      .then(([nextArchives, nextDrafts]) => {
        if (!mounted) return;
        setArchives(nextArchives);
        setDrafts(nextDrafts);
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : "无法读取本地世界。");
      })
      .finally(() => {
        if (mounted) setLibraryReady(true);
      });
    return () => { mounted = false; };
  }, []);

  const latestArchives = useMemo(() => latestWorldArchives(archives), [archives]);
  const { entries: runtimeEntries } = useWorldRuntimeIndex(latestArchives);
  const runningArchives = useMemo(
    () => latestArchives.filter((record) => runtimeEntries.get(record.libraryId)?.status === "running"),
    [latestArchives, runtimeEntries],
  );
  const recentArchives = useMemo(() => [
    ...runningArchives,
    ...latestArchives.filter((record) => !runningArchives.some((running) => running.libraryId === record.libraryId)),
  ].slice(0, 3), [latestArchives, runningArchives]);
  const visibleDrafts = useMemo(() => drafts.slice(0, 2), [drafts]);
  const recentGroups = useMemo(() => groups.slice(0, 3), [groups]);
  const resume = recentArchives[0];
  const selectedTemplate = homeTemplates.find((template) => template.id === selectedTemplateId) ?? homeTemplates[0];

  async function requestTemplateAction(template: WorldTemplatePack, intent: "start" | "edit") {
    try {
      const existingCount = await countWorldsFromTemplate(template);
      if (existingCount > 0) {
        setDuplicateRequest({ template, intent, existingCount });
        return;
      }
      await performTemplateAction(template, intent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法检查本地世界。");
    }
  }

  async function performTemplateAction(template: WorldTemplatePack, intent: "start" | "edit") {
    if (intent === "start") await startTemplate(template);
    else await createFromTemplate(template);
  }

  async function startTemplate(template: WorldTemplatePack) {
    setStartingTemplateId(template.id);
    setError(undefined);
    try {
      const started = await startWorldFromTemplate(template);
      setDrafts((current) => [started.draft, ...current]);
      setArchives((current) => [started.archive, ...current.filter((item) => item.libraryId !== started.archive.libraryId)]);
      navigate(started.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "世界启动失败。");
    } finally {
      setStartingTemplateId(null);
    }
  }

  async function createFromTemplate(template: WorldTemplatePack) {
    setInstallingTemplateId(template.id);
    setError(undefined);
    try {
      const draft = await createDraftFromWorldTemplate(template);
      setDrafts((current) => [draft, ...current]);
      navigate(`/worlds/drafts/${encodeURIComponent(draft.libraryId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "世界草稿创建失败。");
    } finally {
      setInstallingTemplateId(null);
    }
  }

  return (
    <div className="home-page page-enter">
      <header className="home-header">
        <div>
          <p className="eyebrow">CHATVERSE · 探索</p>
          <h1>今天，进入一个世界。</h1>
          <p>旁观一段正在发生的故事，或把自己放进去，让角色记住你的选择。</p>
          <GuideLauncher label="新手引导" onClick={() => setGuideOpen(true)} />
        </div>
        <div className="home-header-actions">
          <Link className="button button-quiet home-header-action" to="/showcase"><Workflow size={16} />编排展示</Link>
          <Link className="button button-quiet home-header-action" to="/worlds/new?view=characters"><LibraryBig size={16} />角色库</Link>
          <Link data-guide="home-create" className="button button-primary home-header-action home-header-create" to="/worlds/new"><Sparkles size={16} />创造世界</Link>
        </div>
      </header>

      {error && <div className="notice notice-danger" role="alert">{error}</div>}

      {selectedTemplate && (
        <section className="home-entry-layout" aria-label="选择世界入口">
          <article className="home-featured-world" data-guide="home-featured">
            <WorldTemplateCover template={selectedTemplate} className="home-featured-media" decorative={false}>
              <div className="home-featured-copy">
                <span className="home-featured-kicker">{selectedTemplate.sourceLabel} · {selectedTemplate.experience}</span>
                <h2>{selectedTemplate.title}</h2>
                <strong>{selectedTemplate.tagline}</strong>
                <p>{selectedTemplate.description}</p>
                <div className="home-featured-actions">
                  <button
                    className="button home-featured-action"
                    disabled={startingTemplateId === selectedTemplate.id || installingTemplateId === selectedTemplate.id}
                    onClick={() => void requestTemplateAction(selectedTemplate, "start")}
                  >
                    <Play size={16} />
                    {startingTemplateId === selectedTemplate.id ? "正在准备…" : "准备进入"}
                  </button>
                  <button
                    className="button home-featured-secondary"
                    disabled={startingTemplateId === selectedTemplate.id || installingTemplateId === selectedTemplate.id}
                    onClick={() => void requestTemplateAction(selectedTemplate, "edit")}
                  >
                    <FilePenLine size={16} />
                    {installingTemplateId === selectedTemplate.id ? "正在创建…" : "基于此创作"}
                  </button>
                </div>
              </div>
              <div className="home-featured-meta">
                <span><UsersRound size={14} />{selectedTemplate.createDraft("home-preview").actors.length} 位角色</span>
                <span><Compass size={14} />{selectedTemplate.duration}</span>
              </div>
            </WorldTemplateCover>
          </article>

          <aside className="home-discovery-panel" data-guide="home-discovery">
            <div className="home-panel-heading">
              <div><p className="eyebrow">世界入口</p><h2>换一个故事</h2></div>
              <BookOpen size={18} />
            </div>
            <div className="home-template-switcher" role="list" aria-label="推荐世界">
              {homeTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={template.id === selectedTemplate.id ? "is-active" : undefined}
                  aria-pressed={template.id === selectedTemplate.id}
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <WorldTemplateCover template={template} className="home-template-thumb" />
                  <span><strong>{template.title}</strong><small>{template.experience} · {template.duration}</small></span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
            <Link className="home-all-templates" to="/groups">浏览全部世界卡包 <ArrowRight size={14} /></Link>

            <div className="home-journey-compact">
              <div className="home-journey-label"><History size={15} /><span>{resume ? "继续上次世界" : "你的旅程"}</span></div>
              {resume ? (
                <Link
                  className="home-resume-item"
                  to={worldArchivePath(resume)}
                >
                  <span className="home-resume-mark"><BookOpen size={17} /></span>
                  <span><strong>{resume.archive.metadata.name}</strong><small>{resume.archive.metadata.lastScene?.text || "回到你离开的地方。"}</small><em>{relativeTime(resume.updatedAt)} · {resume.archive.metadata.eventSequence} 个事件</em></span>
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <p>开始任意世界后，进度会保存在这台设备上。</p>
              )}
              <div className="home-quick-actions">
                <Link to="/worlds/new"><Plus size={15} />从零创造</Link>
                <Link to="/groups"><BookOpen size={15} />我的世界</Link>
              </div>
            </div>
          </aside>
        </section>
      )}

      {runningArchives.length > 0 && (
        <section className="running-world-strip" aria-labelledby="running-worlds-title">
          <div className="running-world-strip-heading">
            <span className="running-world-signal"><Radio size={16} /></span>
            <div><p className="eyebrow">实时运行</p><h2 id="running-worlds-title">世界仍在继续</h2></div>
            <span>{runningArchives.length} 个运行中</span>
          </div>
          <div className="running-world-strip-list">
            {runningArchives.map((record) => {
              const runtime = runtimeEntries.get(record.libraryId);
              return (
                <Link key={record.libraryId} to={worldArchivePath(record)}>
                  <span className="running-dot" />
                  <strong>{record.archive.metadata.name}</strong>
                  <small>{autoPauseLabel(runtime)}</small>
                  <ArrowRight size={15} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="home-section" aria-labelledby="recent-worlds-title">
        <div className="home-section-heading">
          <div><p className="eyebrow">最近活动</p><h2 id="recent-worlds-title">最近进入</h2></div>
          <Link className="text-link" to="/groups">全部世界 <ArrowRight size={14} /></Link>
        </div>
        {!libraryReady ? (
          <div className="home-inline-empty"><LoaderCircle className="is-spinning" size={18} /><span>正在读取你的世界……</span></div>
        ) : recentArchives.length > 0 ? (
          <div className="home-world-grid">
            {recentArchives.map((record) => <ArchiveCard key={record.libraryId} record={record} runtime={runtimeEntries.get(record.libraryId)} />)}
          </div>
        ) : (
          <div className="home-inline-empty"><History size={18} /><span>你进入过的世界会出现在这里。</span><Link to="/worlds/new">开始创造</Link></div>
        )}
      </section>

      <section className="home-lower-grid">
        <section className="home-section" aria-labelledby="drafts-title">
          <div className="home-section-heading"><div><p className="eyebrow">正在创作</p><h2 id="drafts-title">还没写完的世界</h2></div><FilePenLine size={18} /></div>
          {visibleDrafts.length > 0 ? visibleDrafts.map((record) => (
            <Link className="home-draft-row" to={`/worlds/drafts/${encodeURIComponent(record.libraryId)}`} key={record.libraryId}>
              <span className="home-draft-mark"><FilePenLine size={16} /></span>
              <span><strong>{record.draft.metadata.name}</strong><small>{record.draft.premise || "这个世界还在等待第一句设定。"}</small></span>
              <ArrowRight size={15} />
            </Link>
          )) : <div className="home-small-empty">草稿会在这里继续。<Link to="/worlds/new">写下第一句</Link></div>}
        </section>

        <section className="home-section" aria-labelledby="groups-title">
           <div className="home-section-heading"><div><p className="eyebrow">聊天空间</p><h2 id="groups-title">你的群聊</h2></div><MessageCircle size={18} /></div>
          {recentGroups.length > 0 ? recentGroups.map((group) => (
            <Link className="home-chat-row" to={groupWorldManagePath(group.id, group.group)} key={group.id}>
              <span className="group-avatar group-avatar-square">{group.name.slice(0, 1)}</span>
              <span><strong>{group.name}</strong><small>{group.topic || "角色正在等待你加入。"}</small></span>
              <ArrowRight size={15} />
            </Link>
          )) : <div className="home-small-empty">还没有群聊。<Link to="/groups/new">创建一个</Link></div>}
        </section>
      </section>
      <TemplateDuplicateDialog
        request={duplicateRequest}
        onCancel={() => setDuplicateRequest(undefined)}
        onConfirm={() => {
          const request = duplicateRequest;
          setDuplicateRequest(undefined);
          if (request) void performTemplateAction(request.template, request.intent);
        }}
      />
      <GuidedTour
        label="第一次进入 ChatVerse"
        steps={guideSteps}
        open={guideOpen}
        onOpenChange={setGuideOpen}
        onComplete={() => completeOnboardingChapter("home")}
        onDismiss={() => dismissOnboardingChapter("home")}
      />
    </div>
  );
}

function ArchiveCard({ record, runtime }: { record: WorldArchiveRecord; runtime?: WorldRuntimeEntry }) {
  const template = findWorldTemplate({
    worldId: record.archive.worldId,
    name: record.archive.metadata.name,
  });
  const coverImage = template?.assets.cover.src ?? record.archive.metadata.coverImage;
  return (
    <Link className={`home-world-card${runtime?.status === "running" ? " is-running" : ""}`} to={worldArchivePath(record)}>
      <div
        className={`home-world-card-art${coverImage ? " has-cover" : ""}`}
        style={coverImage ? { backgroundImage: `url(${coverImage})` } : undefined}
      >
        <span><BookOpen size={18} /></span>
        <small>{runtime?.status === "running" ? <><i className="running-dot" />运行中</> : relativeTime(record.updatedAt)}</small>
      </div>
      <div className="home-world-card-copy">
        <strong>{record.archive.metadata.name}</strong>
        <p>{record.archive.metadata.lastScene?.text || record.archive.metadata.description || "世界停在一个尚未命名的时刻。"}</p>
        <span><UsersRound size={13} />{record.archive.metadata.actorNames.length} 位角色 <i /> {record.archive.metadata.eventSequence} 个事件</span>
      </div>
    </Link>
  );
}

function worldArchivePath(record: WorldArchiveRecord): string {
  const room = record.lastRoomId ? `&room=${encodeURIComponent(record.lastRoomId)}` : "";
  return `/worlds/${encodeURIComponent(record.archive.worldId)}?archive=${encodeURIComponent(record.libraryId)}${room}`;
}

function autoPauseLabel(runtime?: WorldRuntimeEntry): string {
  if (!runtime?.autoPauseDueAt) return "离开后将按设置自动暂停";
  const remainingMinutes = Math.max(1, Math.ceil((runtime.autoPauseDueAt - Date.now()) / 60_000));
  return `无人查看约 ${remainingMinutes} 分钟后暂停`;
}

function selectHomeTemplates(templates: WorldTemplatePack[]): WorldTemplatePack[] {
  const featured = templates.find((template) => template.featured) ?? templates[0];
  if (!featured) return [];

  const selected = [featured];
  for (const category of ["classic", "education", "anime"] as const) {
    const candidate = templates.find((template) => template.category === category && template.id !== featured.id);
    if (candidate && !selected.some((template) => template.id === candidate.id)) selected.push(candidate);
  }
  for (const template of templates) {
    if (selected.length >= 4) break;
    if (!selected.some((candidate) => candidate.id === template.id)) selected.push(template);
  }
  return selected.slice(0, 4);
}

function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(value);
}
