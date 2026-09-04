import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  HardDrive,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  clearChatVerseStorage,
  clearStorageCategory,
  deleteStorageItem,
  getLocalStorageInventory,
  type StorageCategory,
  type StorageCategorySummary,
  type StorageInventory,
  type StorageItem,
} from "../storageManagement";

const CONFIRMATION_TEXT = "清空本机数据";

export default function StorageSettingsPage() {
  const [inventory, setInventory] = useState<StorageInventory>();
  const [expanded, setExpanded] = useState<Set<StorageCategory>>(
    () => new Set(["world-archives", "world-drafts"]),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<{ category: StorageCategory; item: StorageItem }>();
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function refresh(showLoading = false) {
    if (showLoading) setIsLoading(true);
    setError(undefined);
    try {
      setInventory(await getLocalStorageInventory());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取本机存储失败，请重试。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh(true);
  }, []);

  const categories = inventory?.categories ?? [];
  const workCategories = categories.filter((category) => [
    "world-archives",
    "world-drafts",
    "world-sources",
    "groups",
    "characters",
    "assets",
    "visual-assets",
  ].includes(category.id));
  const runtimeCategories = categories.filter((category) => ["runtime", "provider"].includes(category.id));

  function toggleCategory(id: StorageCategory) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteItem() {
    if (!pendingDelete) return;
    setIsBusy(true);
    setError(undefined);
    try {
      await deleteStorageItem(pendingDelete.category, pendingDelete.item.id);
      setPendingDelete(undefined);
      setNotice(`已删除“${pendingDelete.item.name}”。`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请重试。");
    } finally {
      setIsBusy(false);
    }
  }

  async function clearCategory(category: StorageCategorySummary) {
    if (!category.canClear || category.count === 0) return;
    setIsBusy(true);
    setError(undefined);
    try {
      await clearStorageCategory(category.id);
      setNotice(`已清理${category.label}。`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理失败，请重试。");
    } finally {
      setIsBusy(false);
    }
  }

  async function clearAll() {
    if (confirmation !== CONFIRMATION_TEXT) return;
    setIsBusy(true);
    setError(undefined);
    try {
      await clearChatVerseStorage({ includeProviderSettings: true });
      setClearAllOpen(false);
      setConfirmation("");
      setNotice("已清空本机 ChatVerse 数据。");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清空失败，请重试。");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="workspace-page storage-settings-page page-enter">
      <header className="page-header storage-page-header">
        <div>
          <p className="eyebrow">应用设置 · 本机数据</p>
          <h1>本地存储</h1>
          <p>管理这台设备上的世界、草稿、角色和运行记录。这里只会处理 ChatVerse 自己的数据。</p>
        </div>
        <button className="button button-quiet" type="button" onClick={() => void refresh(true)} disabled={isLoading || isBusy}>
          <RefreshCw size={15} className={isLoading ? "spin" : ""} />
          刷新
        </button>
      </header>

      {error && <div className="storage-alert storage-alert-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
      {notice && <div className="storage-alert storage-alert-success" role="status"><ShieldCheck size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice(undefined)} aria-label="关闭提示">×</button></div>}

      <section className="storage-overview" aria-label="本机存储概览">
        <div className="storage-overview-main"><span className="storage-overview-icon"><HardDrive size={20} /></span><div><span className="eyebrow">ChatVerse 本机数据</span><strong>{isLoading ? "读取中…" : formatBytes(inventory?.totalBytes ?? 0)}</strong><small>作品数据估算大小</small></div></div>
        <div className="storage-overview-stat"><strong>{inventory?.totalItems ?? 0}</strong><span>条记录</span></div>
        <div className="storage-overview-stat"><strong>{formatBytes(inventory?.estimatedUsageBytes ?? 0)}</strong><span>浏览器估算占用</span></div>
      </section>

      <StorageSection title="作品数据" description="你的世界和创作素材会保存在浏览器本地。" categories={workCategories} expanded={expanded} onToggle={toggleCategory} onClear={clearCategory} onDelete={setPendingDelete} disabled={isBusy} />
      <StorageSection title="运行与设备" description="用于刷新恢复和模型连接的设备级数据。" categories={runtimeCategories} expanded={expanded} onToggle={toggleCategory} onClear={clearCategory} onDelete={setPendingDelete} disabled={isBusy} />

      <section className="storage-safety-panel">
        <div className="storage-safety-icon"><ShieldCheck size={20} /></div>
        <div><h2>数据留在本机</h2><p>世界、草稿、角色和连接配置使用当前浏览器保存，不会因为删除这里的记录而影响其他网站。导出作品请在对应的世界或角色页面完成。</p></div>
        <div className="storage-safety-actions">
          <Link className="button button-quiet" to="../models"><KeyRound size={15} />文本模型</Link>
          <Link className="button button-quiet" to="../images"><KeyRound size={15} />图片模型</Link>
        </div>
      </section>

      <section className="storage-danger-panel">
        <div><p className="eyebrow">不可逆操作</p><h2>清空本机 ChatVerse 数据</h2><p>删除全部世界、草稿、群聊、角色、资源、运行记录和模型连接配置。浏览器中的其他站点数据不会受影响。</p></div>
        <button className="button button-danger" type="button" onClick={() => setClearAllOpen(true)} disabled={isBusy || (inventory?.totalItems ?? 0) === 0}><Trash2 size={15} />清空本机数据</button>
      </section>

      {pendingDelete && <ConfirmDialog title={`删除${pendingDelete.item.name}？`} description="这项数据删除后无法在 ChatVerse 中恢复。" confirmLabel="确认删除" onCancel={() => setPendingDelete(undefined)} onConfirm={() => void deleteItem()} busy={isBusy} />}
      {clearAllOpen && <ConfirmDialog title="清空本机数据" description={`请输入“${CONFIRMATION_TEXT}”确认。这个操作会同时删除模型连接配置。`} confirmLabel="确认清空" onCancel={() => { setClearAllOpen(false); setConfirmation(""); }} onConfirm={() => void clearAll()} busy={isBusy} confirmText={confirmation} onConfirmTextChange={setConfirmation} requiredText={CONFIRMATION_TEXT} danger />}

    </div>
  );
}

function StorageSection({
  title,
  description,
  categories,
  expanded,
  onToggle,
  onClear,
  onDelete,
  disabled,
}: {
  title: string;
  description: string;
  categories: StorageCategorySummary[];
  expanded: Set<StorageCategory>;
  onToggle: (id: StorageCategory) => void;
  onClear: (category: StorageCategorySummary) => void;
  onDelete: (value: { category: StorageCategory; item: StorageItem }) => void;
  disabled: boolean;
}) {
  return (
    <section className="storage-section">
      <div className="storage-section-heading"><div><p className="eyebrow">本机数据</p><h2>{title}</h2><p>{description}</p></div></div>
      <div className="storage-category-list">
        {categories.map((category) => <StorageCategoryRow key={category.id} category={category} open={expanded.has(category.id)} onToggle={() => onToggle(category.id)} onClear={() => onClear(category)} onDelete={(item) => onDelete({ category: category.id, item })} disabled={disabled} />)}
      </div>
    </section>
  );
}

function StorageCategoryRow({
  category,
  open,
  onToggle,
  onClear,
  onDelete,
  disabled,
}: {
  category: StorageCategorySummary;
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  onDelete: (item: StorageItem) => void;
  disabled: boolean;
}) {
  return (
    <div className={`storage-category${open ? " is-open" : ""}`}>
      <div className="storage-category-header">
        <button className="storage-category-toggle" type="button" onClick={onToggle} aria-expanded={open}>
          <span className="storage-category-chevron"><ChevronDown size={17} /></span>
          <span className="storage-category-copy"><strong>{category.label}</strong><small>{category.description}</small></span>
        </button>
        <span className="storage-category-count">{category.count} 条 · {formatBytes(category.bytes)}</span>
        {category.canClear && <button className="button button-quiet button-small" type="button" onClick={onClear} disabled={disabled || category.count === 0}><Trash2 size={14} />清理</button>}
      </div>
      {open && <div className="storage-category-detail">
        {category.clearNote && <p className="storage-category-note">{category.clearNote}</p>}
        {category.items.length === 0 ? <p className="storage-category-empty">这里还没有数据。</p> : category.items.map((item) => <div className="storage-item-row" key={item.id}><div className="storage-item-copy"><strong>{item.name}</strong><small>{item.detail || ""}{item.updatedAt ? ` · ${formatDate(item.updatedAt)}` : ""}</small></div><span>{formatBytes(item.bytes)}</span>{item.deletable ? <button className="icon-button danger" type="button" onClick={() => onDelete(item)} disabled={disabled} aria-label={`删除${item.name}`} title={`删除${item.name}`}><Trash2 size={15} /></button> : <small className="storage-item-locked">从属数据</small>}</div>)}
      </div>}
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  busy,
  confirmText,
  onConfirmTextChange,
  requiredText,
  danger = false,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  confirmText?: string;
  onConfirmTextChange?: (value: string) => void;
  requiredText?: string;
  danger?: boolean;
}) {
  const canConfirm = !requiredText || confirmText === requiredText;
  return (
    <div className="storage-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="storage-dialog" role="dialog" aria-modal="true" aria-labelledby="storage-dialog-title">
        <div className={`storage-dialog-icon${danger ? " is-danger" : ""}`}><AlertTriangle size={20} /></div>
        <h2 id="storage-dialog-title">{title}</h2>
        <p>{description}</p>
        {requiredText && <input className="storage-confirm-input" value={confirmText ?? ""} onChange={(event) => onConfirmTextChange?.(event.target.value)} placeholder={requiredText} autoFocus />}
        <div className="storage-dialog-actions"><button className="button button-quiet" type="button" onClick={onCancel} disabled={busy}>取消</button><button className={`button ${danger ? "button-danger" : "button-primary"}`} type="button" onClick={onConfirm} disabled={busy || !canConfirm}>{busy ? "处理中…" : confirmLabel}</button></div>
      </div>
    </div>
  );
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
}
