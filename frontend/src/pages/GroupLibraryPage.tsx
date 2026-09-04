import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpenText, Boxes, Download, FilePenLine, GraduationCap, History, Import, MessageCircle, PackagePlus, Play, Plus, Radio, Search, Sparkles, Trash2, UsersRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { GroupCard } from "@chatverse/core";
import { useChatVerse } from "../app/ChatVerseContext";
import { WorldTemplateCover } from "../components/WorldTemplateCover";
import TemplateDuplicateDialog, { type TemplateDuplicateRequest } from "../components/TemplateDuplicateDialog";
import { deleteWorldDraft, listWorldDrafts, type WorldDraftRecord } from "../worldDraftLibrary";
import { findWorldTemplate, WORLD_TEMPLATE_PACKS, type WorldTemplateCategory, type WorldTemplatePack } from "../worldTemplateCatalog";
import { countWorldsFromTemplate, createDraftFromWorldTemplate, startWorldFromTemplate } from "../worldTemplateLauncher";
import { groupWorldManagePath } from "../world/groupRoutes";
import {
  deleteWorldArchive,
  latestWorldArchives,
  listWorldArchives,
  type WorldArchiveRecord,
} from "../worldArchiveLibrary";
import { useWorldRuntimeIndex } from "../worldRuntimeIndex";

export default function GroupLibraryPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [templateCategory, setTemplateCategory] = useState<"all" | WorldTemplateCategory>("all");
  const [installingTemplateId, setInstallingTemplateId] = useState<string | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<WorldDraftRecord[]>([]);
  const [archives, setArchives] = useState<WorldArchiveRecord[]>([]);
  const [duplicateRequest, setDuplicateRequest] = useState<TemplateDuplicateRequest>();
  const { groups, isLibraryReady, deleteGroup, exportGroup, importGroup } = useChatVerse();
  const visibleGroups = useMemo(() => groups.filter((group) =>
    includesQuery(query, group.name, group.topic, group.humanName),
  ), [groups, query]);
  const latestArchives = useMemo(() => latestWorldArchives(archives), [archives]);
  const { entries: runtimeEntries, refreshing: runtimeRefreshing } = useWorldRuntimeIndex(latestArchives);
  const runningArchives = useMemo(
    () => latestArchives.filter((record) => runtimeEntries.get(record.libraryId)?.status === "running"),
    [latestArchives, runtimeEntries],
  );
  const latestArchiveByDraft = useMemo(() => {
    const result = new Map<string, WorldArchiveRecord>();
    for (const archive of latestArchives) {
      const draftLibraryId = archive.source?.draftLibraryId;
      if (draftLibraryId && !result.has(draftLibraryId)) {
        result.set(draftLibraryId, archive);
      }
    }
    return result;
  }, [latestArchives]);
  const visibleDrafts = useMemo(
    () => drafts.filter((draft) => (
      !latestArchiveByDraft.has(draft.libraryId) &&
      includesQuery(
        query,
        draft.draft.metadata.name,
        draft.draft.metadata.description,
        draft.draft.premise,
        ...draft.draft.actors.map((actor) => actor.card.name),
      )
    )),
    [drafts, latestArchiveByDraft, query],
  );
  const visibleArchives = useMemo(
    () => latestArchives.filter((archive) => {
      const draftLibraryId = archive.source?.draftLibraryId;
      return (
        (!draftLibraryId || latestArchiveByDraft.get(draftLibraryId)?.libraryId === archive.libraryId) &&
        includesQuery(
          query,
          archive.archive.metadata.name,
          archive.archive.metadata.description,
          archive.archive.metadata.lastScene?.text,
          ...archive.archive.metadata.actorNames,
        )
      );
    }),
    [latestArchives, latestArchiveByDraft, query],
  );
  const resumableArchives = useMemo(
    () => visibleArchives.filter((record) => runtimeEntries.get(record.libraryId)?.status !== "running"),
    [runtimeEntries, visibleArchives],
  );
  const visibleTemplates = useMemo(() => WORLD_TEMPLATE_PACKS.filter((template) => (
    (templateCategory === "all" || template.category === templateCategory) &&
    includesQuery(query, template.title, template.tagline, template.description, template.sourceLabel, template.experience)
  )), [query, templateCategory]);
  const featuredTemplate = visibleTemplates.find((template) => template.featured) ?? visibleTemplates[0];

  useEffect(() => {
    void listWorldDrafts().then(setDrafts).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "无法读取世界草稿。");
    });
    void listWorldArchives().then(setArchives).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "无法读取本地世界存档。");
    });
  }, []);

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const record = await importGroup(file);
      navigate(groupWorldManagePath(record.libraryId, record.group));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "世界包无法导入。");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

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
    if (intent === "start") await startTemplateWorld(template);
    else await installTemplate(template);
  }

  async function installTemplate(template: WorldTemplatePack) {
    setInstallingTemplateId(template.id);
    setError(null);
    setNotice(null);
    try {
      const record = await createDraftFromWorldTemplate(template);
      setDrafts((current) => [record, ...current]);
      setNotice(`“${template.title}”已加入你的世界库。`);
      navigate(`/worlds/drafts/${encodeURIComponent(record.libraryId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "世界卡包安装失败。");
    } finally {
      setInstallingTemplateId(null);
    }
  }

  async function startTemplateWorld(template: WorldTemplatePack) {
    setStartingTemplateId(template.id);
    setError(null);
    setNotice(null);
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

  async function removeDraft(record: WorldDraftRecord) {
    if (!window.confirm(`确定删除“${record.draft.metadata.name}”这份草稿吗？`)) return;
    try {
      await deleteWorldDraft(record.libraryId);
      setDrafts((current) => current.filter((item) => item.libraryId !== record.libraryId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "草稿删除失败。");
    }
  }

  async function removeArchive(record: WorldArchiveRecord) {
    if (!window.confirm(`确定删除“${record.archive.metadata.name}”的本地进度吗？`)) return;
    try {
      await deleteWorldArchive(record.libraryId);
      setArchives((current) => current.filter((item) => item.libraryId !== record.libraryId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "世界进度删除失败。");
    }
  }

  async function removeGroup(group: typeof visibleGroups[number]) {
    if (!window.confirm(`确定删除“${group.name}”吗？群配置、资源和本地聊天进度都会删除，角色库中的独立角色不会受影响。`)) return;
    try {
      await deleteGroup(group.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "群聊删除失败。");
    }
  }

  return (
    <div className="library-page page-enter">
      <header className="library-header">
        <div>
          <p className="eyebrow">WORLD PACK LIBRARY</p>
          <h1>你的世界</h1>
          <p>从一套完整的世界卡包开始，再把人物、关系和剧情改成只属于你的版本。</p>
        </div>
        <div className="header-actions">
          <label className="search-field library-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索卡包或本地世界" aria-label="搜索卡包或本地世界" />
          </label>
          <input ref={inputRef} type="file" accept=".chatverse.zip,.zip,application/zip" hidden onChange={(event) => void onImport(event.target.files?.[0])} />
          <button className="button button-quiet" onClick={() => inputRef.current?.click()}><Import size={16} />导入世界包</button>
          <Link className="button button-primary" to="/worlds/new"><Sparkles size={16} />创建世界</Link>
        </div>
      </header>

      {error && <div className="notice notice-danger" role="alert">{error}</div>}
      {notice && <div className="notice notice-success" role="status">{notice}</div>}

      {runningArchives.length > 0 && (
        <section className="library-running-worlds" aria-labelledby="library-running-title">
          <div className="section-heading compact">
            <div><p className="eyebrow">实时状态</p><h2 id="library-running-title">正在运行</h2></div>
            <span className="library-count"><Radio size={13} /> {runningArchives.length} 个世界</span>
          </div>
          <div className="running-world-collection">
            {runningArchives.map((record) => {
              const runtime = runtimeEntries.get(record.libraryId);
              return (
                <Link className="running-world-row" to={worldArchivePath(record)} key={record.libraryId}>
                  <span className="running-world-mark"><Radio size={17} /></span>
                  <span>
                    <strong>{record.archive.metadata.name}</strong>
                    <small>{runtime?.viewerCount ? "当前页面正在查看" : autoPauseLabel(runtime?.autoPauseDueAt)}</small>
                  </span>
                  <span className="running-world-state"><i className="running-dot" />运行中</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="world-market" aria-labelledby="world-market-title">
        <div className="world-market-heading">
          <div>
            <p className="eyebrow">精选卡包</p>
            <h2 id="world-market-title">选择一个故事入口</h2>
            <p>卡包只提供开场、角色和矛盾。复制后，世界如何发展由你决定。</p>
          </div>
          <div className="world-market-filters" role="group" aria-label="筛选世界卡包">
            {([
              ["all", "全部"],
              ["classic", "经典重构"],
              ["anime", "原创幻想"],
              ["education", "教育推演"],
            ] as const).map(([value, label]) => (
              <button key={value} className={templateCategory === value ? "is-active" : ""} onClick={() => setTemplateCategory(value)}>{label}</button>
            ))}
          </div>
        </div>

        {featuredTemplate && (
          <article className={`world-pack-feature world-pack-art-${featuredTemplate.accent}`}>
            <WorldTemplateCover template={featuredTemplate} className="world-pack-feature-art">
              <span className="world-pack-index">CV / {String(WORLD_TEMPLATE_PACKS.indexOf(featuredTemplate) + 1).padStart(2, "0")}</span>
              <BookOpenText size={34} />
              <small>{featuredTemplate.sourceLabel}</small>
            </WorldTemplateCover>
            <div className="world-pack-feature-copy">
              <div className="world-pack-badges"><span>{featuredTemplate.sourceLabel}</span><span>{featuredTemplate.experience}</span></div>
              <h3>{featuredTemplate.title}</h3>
              <strong>{featuredTemplate.tagline}</strong>
              <p>{featuredTemplate.description}</p>
              <div className="world-pack-meta"><span>{featuredTemplate.createDraft("preview").actors.length} 位角色</span><span>{featuredTemplate.duration}</span><span>观看 / 参与 / 导演</span></div>
              <div className="world-pack-actions">
                <button className="button button-primary" disabled={startingTemplateId === featuredTemplate.id || installingTemplateId === featuredTemplate.id} onClick={() => void requestTemplateAction(featuredTemplate, "start")}><Play size={16} />{startingTemplateId === featuredTemplate.id ? "正在准备…" : "准备进入世界"}</button>
                <button className="button button-quiet" disabled={startingTemplateId === featuredTemplate.id || installingTemplateId === featuredTemplate.id} onClick={() => void requestTemplateAction(featuredTemplate, "edit")}><FilePenLine size={16} />{installingTemplateId === featuredTemplate.id ? "正在创建…" : "开始创作"}</button>
                {featuredTemplate.id === "midnight-archive" && <Link className="button button-quiet" to="/showcase">查看编排演示</Link>}
              </div>
            </div>
          </article>
        )}

        <div className="world-pack-grid">
          {visibleTemplates.filter((template) => template.id !== featuredTemplate?.id).map((template) => (
            <article className="world-pack-card" key={template.id}>
              <WorldTemplateCover template={template} className={`world-pack-card-art world-pack-art-${template.accent}`}>
                <span>{template.category === "education" ? <GraduationCap size={22} /> : template.category === "classic" ? <BookOpenText size={22} /> : <Sparkles size={22} />}</span>
                <small>{template.sourceLabel}</small>
              </WorldTemplateCover>
              <div className="world-pack-card-copy">
                <span className="world-pack-kicker">{template.experience} · {template.duration}</span>
                <h3>{template.title}</h3>
                <p>{template.tagline}</p>
                <div className="world-pack-card-footer">
                  <span><UsersRound size={13} />{template.createDraft("preview").actors.length} 位角色</span>
                  <button className="icon-button" title={`将 ${template.title} 加入世界库`} aria-label={`将 ${template.title} 加入世界库`} disabled={installingTemplateId === template.id} onClick={() => void requestTemplateAction(template, "edit")}><PackagePlus size={17} /></button>
                </div>
              </div>
            </article>
          ))}
          {visibleTemplates.length === 0 && <div className="world-pack-empty"><Boxes size={22} /><span>没有匹配的世界卡包，换个关键词或分类试试。</span></div>}
        </div>
      </section>

      {resumableArchives.length > 0 && (
        <section className="library-primary" aria-labelledby="world-archives-title">
          <div className="section-heading compact">
            <div>
                <p className="eyebrow">你的进度</p>
              <h2 id="world-archives-title">继续世界</h2>
            </div>
            <span className="library-count">{runtimeRefreshing ? "正在确认状态" : `${resumableArchives.length} 个可继续世界`}</span>
          </div>
          <div className="world-archive-grid">
            {resumableArchives.map((record, index) => {
              const template = findWorldTemplate({
                worldId: record.archive.worldId,
                name: record.archive.metadata.name,
              });
              const coverImage = template?.assets.cover.src ?? record.archive.metadata.coverImage;
              const scene = record.archive.metadata.lastScene?.text
                || record.archive.metadata.description
                || "世界停在一个尚未命名的时刻。";
              return (
                <article className={`world-archive-card world-archive-art-${index % 4}`} key={record.libraryId}>
                  <Link className="world-archive-card-main" to={worldArchivePath(record)}>
                    <div
                      className={`world-archive-card-art${coverImage ? " has-cover" : ""}`}
                      style={coverImage ? { backgroundImage: `url(${coverImage})` } : undefined}
                    >
                      <span className="world-archive-card-art-icon"><History size={18} /></span>
                      <small>{formatUpdated(record.updatedAt)}</small>
                    </div>
                    <div className="world-archive-card-copy">
                      <div className="world-archive-card-title">
                        <strong>{record.archive.metadata.name}</strong>
                        <span>{record.archive.metadata.eventSequence} 个事件</span>
                      </div>
                      <p>{scene}</p>
                      <span className="world-archive-card-meta"><UsersRound size={13} />{record.archive.metadata.actorNames.length} 位角色 <i /> 可继续</span>
                      <span className="world-archive-card-cta">继续这个世界 <ArrowRight size={14} /></span>
                    </div>
                  </Link>
                  <div className="world-archive-card-actions">
                    {record.source && (
                      <Link
                        className="icon-button"
                        title="编辑源草稿"
                        aria-label="编辑源草稿"
                        to={`/worlds/drafts/${encodeURIComponent(record.source.draftLibraryId)}`}
                      >
                        <FilePenLine size={16} />
                      </Link>
                    )}
                    <button
                      className="icon-button"
                      title="删除本地进度"
                      aria-label={`删除 ${record.archive.metadata.name} 的本地进度`}
                      onClick={() => void removeArchive(record)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {visibleDrafts.length > 0 && (
        <section className="library-primary world-draft-shelf" aria-labelledby="drafts-title">
          <div className="section-heading compact">
            <div><p className="eyebrow">世界创作</p><h2 id="drafts-title">创作中的世界</h2></div>
            <span className="library-count">{visibleDrafts.length} 份本地草稿</span>
          </div>
          <div className="world-draft-grid">
            {visibleDrafts.map((record, index) => (
              <article className={`world-draft-card world-draft-tone-${index % 3}`} key={record.libraryId}>
                <Link className="world-draft-card-main" to={`/worlds/drafts/${record.libraryId}`}>
                  <div className="world-draft-card-topline">
                    <span className="world-draft-card-mark"><FilePenLine size={16} /></span>
                    <span className="world-draft-card-kicker">创作草稿</span>
                    <time>{formatUpdated(record.updatedAt)}</time>
                  </div>
                  <div className="world-draft-card-copy">
                    <strong>{record.draft.metadata.name}</strong>
                    <p>{record.draft.premise || "这个世界还在等待第一句设定。"}</p>
                  </div>
                  <div className="world-draft-card-footer">
                    <span className="world-draft-card-meta"><GitMeta draft={record.draft} /></span>
                    <span className="world-draft-card-cta">继续创作 <ArrowRight size={14} /></span>
                  </div>
                </Link>
                <div className="world-draft-card-actions">
                  <button
                    className="icon-button"
                    title="删除草稿"
                    aria-label={`删除 ${record.draft.metadata.name} 草稿`}
                    onClick={() => void removeDraft(record)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="library-primary" aria-labelledby="my-groups-title">
        <div className="section-heading">
          <div>
             <p className="eyebrow">聊天空间</p>
            <h2 id="my-groups-title">我的群聊</h2>
          </div>
        </div>

        {!isLibraryReady ? <div className="page-loading">正在读取本地群库…</div> : visibleGroups.length === 0 ? (
          <EmptyLibrary query={query} />
        ) : (
          <div className="group-collection">
            {visibleGroups.map((group) => (
              <article className="group-row" key={group.id}>
                <Link className="group-row-main" to={groupOpenPath(group)}>
                  <div className="group-avatar group-avatar-square">{group.name.slice(0, 1)}</div>
                  <div className="group-row-copy">
                    <div className="group-row-title"><strong>{group.name}</strong><time>{formatUpdated(group.updatedAt)}</time></div>
                    <p>{group.topic || "还没有写下此刻的场景。"}</p>
                    <span><UsersRound size={13} />你是 {group.humanName} · {group.memberCount} 位成员 · {group.group.worldRef ? "从所属世界进入" : "独立群聊"}</span>
                  </div>
                </Link>
                <Link className="icon-button" title={`用创作助手编辑 ${group.name}`} aria-label={`用创作助手编辑 ${group.name}`} to={`/worlds/new?groupId=${encodeURIComponent(group.id)}`}><Sparkles size={16} /></Link>
                <button className="icon-button" title={`导出 ${group.name}`} aria-label={`导出 ${group.name}`} onClick={() => void exportGroup(group.id)}><Download size={16} /></button>
                <button className="icon-button" title={`删除 ${group.name}`} aria-label={`删除 ${group.name}`} onClick={() => void removeGroup(group)}><Trash2 size={16} /></button>
              </article>
            ))}
          </div>
        )}
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
    </div>
  );
}

function worldArchivePath(record: WorldArchiveRecord): string {
  const room = record.lastRoomId ? `&room=${encodeURIComponent(record.lastRoomId)}` : "";
  return `/worlds/${encodeURIComponent(record.archive.worldId)}?archive=${encodeURIComponent(record.libraryId)}${room}`;
}

function autoPauseLabel(dueAt?: number): string {
  if (!dueAt) return "离开后将按全局设置自动暂停";
  const minutes = Math.max(1, Math.ceil((dueAt - Date.now()) / 60_000));
  return `无人查看约 ${minutes} 分钟后暂停`;
}

function EmptyLibrary({ query }: { query: string }) {
  return (
    <div className="empty-state">
      <MessageCircle size={24} />
      <h3>{query ? "没有匹配的群聊" : "这里还没有群聊"}</h3>
      <p>{query ? "换个关键词试试，或回到完整世界库。" : "从一颗世界火种开始，角色、关系和故事会在这里继续生长。"}</p>
      {!query && <Link className="button button-primary" to="/worlds/new"><Plus size={16} />创建第一个世界</Link>}
    </div>
  );
}

function GitMeta({ draft }: { draft: WorldDraftRecord["draft"] }) {
  return (
    <>
      {draft.runtimeProfile === "world_story" ? "叙事世界" : "群聊"}
      {" · "}
      {draft.actors.length} 位角色
    </>
  );
}

function includesQuery(query: string, ...values: Array<string | undefined>): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return values.filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized);
}

function groupOpenPath(group: { id: string; group: GroupCard }): string {
  return groupWorldManagePath(group.id, group.group);
}

function formatUpdated(updatedAt: number) {
  const elapsed = Date.now() - updatedAt;
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(updatedAt);
}
