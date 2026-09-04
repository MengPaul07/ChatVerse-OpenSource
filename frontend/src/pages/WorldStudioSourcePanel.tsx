import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { WorldSourceBinding } from "@chatverse/core";
import type { WorldSourceDocumentInput } from "@chatverse/world-source";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpenText,
  Check,
  FilePlus2,
  Files,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import {
  deleteWorldSource,
  importWorldSourceFiles,
  listWorldSources,
  reviseArchitectWorldSource,
  type WorldSourceLibraryRecord,
} from "../worldSourceLibrary";

type SourceFidelity = WorldSourceBinding["fidelity"];
const MAX_BOUND_SOURCES = 8;

export interface WorldStudioSourcePanelProps {
  bindings: readonly WorldSourceBinding[];
  disabled?: boolean;
  onBindingsChange: (bindings: WorldSourceBinding[], summary: string) => Promise<void>;
  onError?: (message: string) => void;
}

export default function WorldStudioSourcePanel({
  bindings,
  disabled = false,
  onBindingsChange,
  onError,
}: WorldStudioSourcePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<WorldSourceLibraryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [editorRecord, setEditorRecord] = useState<WorldSourceLibraryRecord>();
  const [editorDocuments, setEditorDocuments] = useState<WorldSourceDocumentInput[]>([]);
  const [activeDocument, setActiveDocument] = useState(0);
  const [preview, setPreview] = useState(false);
  const bindingRevisionSignature = bindings
    .map((binding) => revisionKey(binding.bundleId, binding.revision))
    .join("|");

  const reportError = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    onError?.(message);
  }, [onError]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await listWorldSources());
    } catch (cause) {
      reportError(cause);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh, bindingRevisionSignature]);

  const recordByRevision = useMemo(() => new Map(
    records.map((record) => [revisionKey(record.bundle.id, record.bundle.revision), record]),
  ), [records]);
  const boundKeys = useMemo(() => new Set(
    bindings.map((binding) => revisionKey(binding.bundleId, binding.revision)),
  ), [bindings]);
  const availableRecords = records.filter((record) => (
    !boundKeys.has(revisionKey(record.bundle.id, record.bundle.revision))
  ));

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (bindings.length >= MAX_BOUND_SOURCES) {
      reportError(`一个世界最多绑定 ${MAX_BOUND_SOURCES} 份资料源，请先解除一份绑定。`);
      return;
    }
    await perform("import", async () => {
      const record = await importWorldSourceFiles(files);
      await refresh();
      const alreadyBound = bindings.some((binding) => (
        binding.bundleId === record.bundle.id && binding.revision === record.bundle.revision
      ));
      if (!alreadyBound) {
        await onBindingsChange([
          ...bindings,
          {
            bundleId: record.bundle.id,
            revision: record.bundle.revision,
            fidelity: "reference",
          },
        ], `导入并绑定资料源：${record.bundle.metadata.name}`);
      }
    });
  }

  async function bindRecord(record: WorldSourceLibraryRecord) {
    if (bindings.length >= MAX_BOUND_SOURCES) {
      reportError(`一个世界最多绑定 ${MAX_BOUND_SOURCES} 份资料源，请先解除一份绑定。`);
      return;
    }
    await perform(record.libraryId, () => onBindingsChange([
      ...bindings,
      {
        bundleId: record.bundle.id,
        revision: record.bundle.revision,
        fidelity: "reference",
      },
    ], `绑定资料源：${record.bundle.metadata.name}`));
  }

  async function unbind(binding: WorldSourceBinding) {
    const key = revisionKey(binding.bundleId, binding.revision);
    const record = recordByRevision.get(key);
    await perform(key, () => onBindingsChange(
      bindings.filter((candidate) => revisionKey(candidate.bundleId, candidate.revision) !== key),
      `解除资料源绑定：${record?.bundle.metadata.name ?? binding.bundleId}`,
    ));
  }

  async function changeFidelity(binding: WorldSourceBinding, fidelity: SourceFidelity) {
    const key = revisionKey(binding.bundleId, binding.revision);
    const record = recordByRevision.get(key);
    await perform(key, () => onBindingsChange(
      bindings.map((candidate) => (
        revisionKey(candidate.bundleId, candidate.revision) === key
          ? { ...candidate, fidelity }
          : candidate
      )),
      `调整资料源遵循方式：${record?.bundle.metadata.name ?? binding.bundleId}`,
    ));
  }

  async function removeRecord(record: WorldSourceLibraryRecord) {
    if (!window.confirm(`确定删除本机资料源“${record.bundle.metadata.name}”吗？`)) return;
    await perform(record.libraryId, async () => {
      await deleteWorldSource(record.libraryId);
      await refresh();
    });
  }

  function openMarkdownEditor(record: WorldSourceLibraryRecord) {
    if ((record.origin ?? "user_import") !== "architect") return;
    setEditorRecord(record);
    setEditorDocuments(record.bundle.documents.map((document) => ({
      id: document.id,
      path: document.path,
      title: document.title,
      format: "markdown",
      content: document.text,
    })));
    setActiveDocument(0);
    setPreview(false);
  }

  function patchActiveDocument(patch: Partial<WorldSourceDocumentInput>) {
    setEditorDocuments((documents) => documents.map((document, index) => (
      index === activeDocument ? { ...document, ...patch } : document
    )));
  }

  function addDocument() {
    const nextIndex = editorDocuments.length;
    setEditorDocuments((documents) => [...documents, {
      path: `notes-${nextIndex + 1}.md`,
      title: `补充资料 ${nextIndex + 1}`,
      format: "markdown",
      content: `# 补充资料 ${nextIndex + 1}\n\n`,
    }]);
    setActiveDocument(nextIndex);
  }

  async function saveMarkdownEditor() {
    if (!editorRecord) return;
    await perform(`edit:${editorRecord.libraryId}`, async () => {
      const next = await reviseArchitectWorldSource(editorRecord, editorDocuments);
      const previousKey = revisionKey(editorRecord.bundle.id, editorRecord.bundle.revision);
      const currentBinding = bindings.find((binding) => revisionKey(binding.bundleId, binding.revision) === previousKey);
      if (currentBinding) {
        await onBindingsChange(bindings.map((binding) => (
          revisionKey(binding.bundleId, binding.revision) === previousKey
            ? { ...binding, revision: next.bundle.revision }
            : binding
        )), `更新 Markdown 资料：${next.bundle.metadata.name} r${next.bundle.revision}`);
      }
      setEditorRecord(undefined);
      await refresh();
    });
  }

  async function perform(key: string, action: () => Promise<void>) {
    setPending(key);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      reportError(cause);
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section className="studio-source-panel" aria-labelledby="studio-source-title">
      <header className="studio-source-heading">
        <span className="studio-source-icon"><BookOpenText size={16} /></span>
        <div>
          <p>SOURCE LIBRARY</p>
          <h2 id="studio-source-title">世界资料源</h2>
        </div>
        <span className="studio-source-count">{bindings.length} 份已绑定</span>
        <input
          ref={inputRef}
          className="studio-source-file-input"
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          multiple
          onChange={(event) => void importFiles(event)}
          disabled={disabled || Boolean(pending) || bindings.length >= MAX_BOUND_SOURCES}
        />
        <button
          className="button button-quiet studio-source-import"
          type="button"
          title={bindings.length >= MAX_BOUND_SOURCES ? `最多绑定 ${MAX_BOUND_SOURCES} 份资料源` : "导入 Markdown 或纯文本"}
          disabled={disabled || Boolean(pending) || bindings.length >= MAX_BOUND_SOURCES}
          onClick={() => inputRef.current?.click()}
        >
          {pending === "import" ? <LoaderCircle className="is-spinning" size={14} /> : <FilePlus2 size={14} />}
          导入文档
        </button>
      </header>

      <p className="studio-source-intro">
        把长篇设定、原作章节或研究资料交给导演按需检索。草稿只记录绑定版本，原文留在这台设备。
      </p>

      {error && <p className="studio-source-error" role="alert">{error}</p>}

      <div className="studio-source-bound-list">
        {bindings.map((binding) => {
          const key = revisionKey(binding.bundleId, binding.revision);
          const record = recordByRevision.get(key);
          return (
            <article className={`studio-source-row${record ? "" : " is-missing"}`} key={key}>
              <span className="studio-source-file"><Files size={15} /></span>
              <div className="studio-source-copy">
                <strong>{record?.bundle.metadata.name ?? binding.bundleId}</strong>
                <small>
                  {record
                    ? sourceMetrics(record)
                    : `revision ${binding.revision} · 本机缺少原始资料`}
                </small>
                {record && (
                  <span className={`studio-source-origin is-${record.origin ?? "user_import"}`}>
                    {(record.origin ?? "user_import") === "architect"
                      ? "创作助手资料 · 可修订"
                      : <><LockKeyhole size={11} />用户原始资料 · 只读</>}
                  </span>
                )}
              </div>
              <label className="studio-source-fidelity">
                <span>使用方式</span>
                <select
                  value={binding.fidelity}
                  disabled={disabled || Boolean(pending)}
                  onChange={(event) => void changeFidelity(binding, event.target.value as SourceFidelity)}
                >
                  <option value="strict">严格遵循</option>
                  <option value="reference">参考改编</option>
                  <option value="free">自由取材</option>
                </select>
              </label>
              {record && (record.origin ?? "user_import") === "architect" && (
                <button
                  className="icon-button"
                  type="button"
                  title="编辑 Markdown"
                  aria-label={`编辑 ${record.bundle.metadata.name}`}
                  disabled={disabled || Boolean(pending)}
                  onClick={() => openMarkdownEditor(record)}
                >
                  <Pencil size={14} />
                </button>
              )}
              {(!record || (record.origin ?? "user_import") !== "architect") && <span className="studio-source-edit-placeholder" />}
              <button
                className="icon-button studio-source-unbind"
                type="button"
                title="解除绑定"
                aria-label={`解除绑定 ${record?.bundle.metadata.name ?? binding.bundleId}`}
                disabled={disabled || Boolean(pending)}
                onClick={() => void unbind(binding)}
              >
                {pending === key ? <LoaderCircle className="is-spinning" size={14} /> : <Unlink size={14} />}
              </button>
            </article>
          );
        })}
        {!loading && bindings.length === 0 && (
          <button
            className="studio-source-empty"
            type="button"
            disabled={disabled || Boolean(pending)}
            onClick={() => inputRef.current?.click()}
          >
            <FilePlus2 size={18} />
            <span><strong>导入第一份世界资料</strong><small>支持多选 .md 与 .txt，系统会建立章节索引。</small></span>
          </button>
        )}
        {loading && <div className="studio-source-loading"><LoaderCircle className="is-spinning" size={15} />读取本地资料库</div>}
      </div>

      {availableRecords.length > 0 && (
        <details className="studio-source-library">
          <summary>本地还有 {availableRecords.length} 个未绑定版本</summary>
          <div>
            {availableRecords.map((record) => (
              <article key={record.libraryId}>
                <span><strong>{record.bundle.metadata.name}</strong><small>{sourceMetrics(record)}</small></span>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={disabled || Boolean(pending) || bindings.length >= MAX_BOUND_SOURCES}
                  onClick={() => void bindRecord(record)}
                >
                  {pending === record.libraryId ? <LoaderCircle className="is-spinning" size={13} /> : <Check size={13} />}
                  绑定
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title="删除本地资料"
                  aria-label={`删除 ${record.bundle.metadata.name}`}
                  disabled={disabled || Boolean(pending)}
                  onClick={() => void removeRecord(record)}
                >
                  <Trash2 size={13} />
                </button>
              </article>
            ))}
          </div>
        </details>
      )}

      {editorRecord && editorDocuments[activeDocument] && (
        <div className="studio-source-editor-backdrop" role="presentation">
          <section className="studio-source-editor" role="dialog" aria-modal="true" aria-label="Markdown 世界资料编辑器">
            <header>
              <div>
                <p>MARKDOWN SOURCE</p>
                <h2>{editorRecord.bundle.metadata.name}</h2>
                <small>保存会创建新 revision，旧版本保持不变。</small>
              </div>
              <button className="icon-button" type="button" title="关闭" onClick={() => setEditorRecord(undefined)}>×</button>
            </header>
            <div className="studio-source-editor-body">
              <nav aria-label="资料文档">
                {editorDocuments.map((document, index) => (
                  <button
                    type="button"
                    className={index === activeDocument ? "is-active" : ""}
                    onClick={() => setActiveDocument(index)}
                    key={`${document.path}:${index}`}
                  >
                    <BookOpenText size={13} /><span>{document.title || document.path}</span>
                  </button>
                ))}
                {editorDocuments.length < 6 && <button type="button" onClick={addDocument}><Plus size={13} />新增文档</button>}
              </nav>
              <div className="studio-source-editor-main">
                <div className="studio-source-editor-fields">
                  <label><span>标题</span><input value={editorDocuments[activeDocument]!.title ?? ""} onChange={(event) => patchActiveDocument({ title: event.target.value })} /></label>
                  <label><span>路径</span><input value={editorDocuments[activeDocument]!.path} onChange={(event) => patchActiveDocument({ path: event.target.value })} /></label>
                  <button className="button button-quiet" type="button" onClick={() => setPreview((value) => !value)}>{preview ? "编辑源码" : "预览"}</button>
                </div>
                {preview ? (
                  <div className="studio-source-markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{editorDocuments[activeDocument]!.content}</ReactMarkdown></div>
                ) : (
                  <textarea
                    className="studio-source-markdown-input"
                    spellCheck={false}
                    value={editorDocuments[activeDocument]!.content}
                    onChange={(event) => patchActiveDocument({ content: event.target.value })}
                  />
                )}
              </div>
            </div>
            <footer>
              <span>{editorDocuments.reduce((sum, document) => sum + document.content.length, 0).toLocaleString()} / 24,000 字符</span>
              <button className="button button-quiet" type="button" onClick={() => setEditorRecord(undefined)}>取消</button>
              <button className="button button-primary" type="button" disabled={Boolean(pending)} onClick={() => void saveMarkdownEditor()}>
                {pending?.startsWith("edit:") ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />}保存新版本
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

function revisionKey(bundleId: string, revision: number): string {
  return `${bundleId}@${revision}`;
}

function sourceMetrics(record: WorldSourceLibraryRecord): string {
  const { bundle } = record;
  return `${bundle.documents.length} 篇 · ${bundle.sections.length} 节 · ${bundle.chunks.length} 个检索片段 · r${bundle.revision}`;
}
