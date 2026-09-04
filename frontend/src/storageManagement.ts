import {
  clearProviderSettings,
  readProviderSettings,
} from "./providerSettings";
import {
  clearImageProviderSettings,
  IMAGE_PROVIDER_SETTINGS_STORAGE_KEY,
  readImageProviderSettings,
} from "./imageProviderSettings";
import {
  deleteLibraryCharacter,
  listLibraryCharacters,
  type LibraryCharacterRecord,
} from "./characterLibrary";
import {
  deleteLibraryGroup,
  listLibraryGroups,
  type LibraryGroupRecord,
} from "./groupLibrary";
import {
  deleteWorldArchive,
  listWorldArchives,
  type WorldArchiveRecord,
} from "./worldArchiveLibrary";
import {
  deleteWorldDraft,
  listWorldDrafts,
  type WorldDraftRecord,
} from "./worldDraftLibrary";
import {
  assertWorldSourceCanDelete,
  deleteWorldSource,
  listWorldSources,
  type WorldSourceLibraryRecord,
} from "./worldSourceLibrary";
import {
  GROUP_ASSET_STORE,
  VISUAL_ASSET_STORE,
  openLibraryDatabase,
} from "./localLibraryDatabase";

export type StorageCategory =
  | "groups"
  | "world-drafts"
  | "world-archives"
  | "world-sources"
  | "characters"
  | "assets"
  | "visual-assets"
  | "runtime"
  | "provider";

export interface StorageItem {
  id: string;
  name: string;
  detail?: string;
  updatedAt?: number;
  bytes: number;
  deletable: boolean;
  deletionNote?: string;
}

export interface StorageCategorySummary {
  id: StorageCategory;
  label: string;
  description: string;
  count: number;
  bytes: number;
  items: StorageItem[];
  canClear: boolean;
  clearNote?: string;
}

export interface StorageInventory {
  categories: StorageCategorySummary[];
  estimatedUsageBytes?: number;
  estimatedQuotaBytes?: number;
  totalItems: number;
  totalBytes: number;
  generatedAt: number;
}

export interface ClearStorageOptions {
  includeProviderSettings?: boolean;
}

const PROVIDER_SETTINGS_KEY = "chatverse:provider-settings";
const PROVIDER_SETTINGS_KEYS = new Set([PROVIDER_SETTINGS_KEY, IMAGE_PROVIDER_SETTINGS_STORAGE_KEY]);
const CHATVERSE_KEY_PREFIX = "chatverse:";

interface AssetRecord {
  key: string;
  libraryId: string;
  path: string;
  blob: Blob;
}

interface VisualAssetRecord { id: string; kind: string; ownerId: string; blob: Blob; createdAt: number }

interface LocalStorageEntry {
  key: string;
  value: string;
  bytes: number;
}

export async function getLocalStorageInventory(): Promise<StorageInventory> {
  const [groups, drafts, archives, sources, characters, assets, visualAssets] = await Promise.all([
    listLibraryGroups(),
    listWorldDrafts(),
    listWorldArchives(),
    listWorldSources(),
    listLibraryCharacters(),
    listAssets(),
    listVisualAssets(),
  ]);
  const localEntries = readLocalStorageEntries();
  const localCategories = createLocalCategories(localEntries);
  const categories: StorageCategorySummary[] = [
    createGroupCategory(groups, assets),
    createDraftCategory(drafts),
    createArchiveCategory(archives),
    createWorldSourceCategory(sources),
    createCharacterCategory(characters),
    createAssetCategory(assets, groups),
    category("visual-assets", "视觉素材", "角色立绘与各幕背景，图片字节只保存在当前浏览器。", visualAssets.map((asset) => ({ id: asset.id, name: asset.kind === "beat_background" ? "剧情背景" : "角色立绘", detail: asset.ownerId, updatedAt: asset.createdAt, bytes: asset.blob.size, deletable: true })), true),
    localCategories.runtime,
    localCategories.provider,
  ];
  const estimate = await readStorageEstimate();
  const totalItems = categories.reduce((sum, category) => sum + category.count, 0);
  const totalBytes = categories.reduce((sum, category) => sum + category.bytes, 0);

  return {
    categories,
    estimatedUsageBytes: estimate?.usage,
    estimatedQuotaBytes: estimate?.quota,
    totalItems,
    totalBytes,
    generatedAt: Date.now(),
  };
}

export async function deleteStorageItem(category: StorageCategory, id: string): Promise<void> {
  switch (category) {
    case "groups":
      await deleteLibraryGroup(id);
      return;
    case "world-drafts":
      await deleteWorldDraft(id);
      return;
    case "world-archives":
      await deleteWorldArchive(id);
      removeArchivePointers(id);
      return;
    case "world-sources":
      await deleteWorldSource(id);
      return;
    case "characters":
      await deleteLibraryCharacter(id);
      return;
    case "runtime":
      removeRuntimeStorageKey(id);
      return;
    case "provider":
      if (id === PROVIDER_SETTINGS_KEY) clearProviderSettings();
      else if (id === IMAGE_PROVIDER_SETTINGS_STORAGE_KEY) clearImageProviderSettings();
      else throw new Error("未知的设备配置。");
      return;
    case "assets":
      throw new Error("资源属于群聊，应该随所属群聊一起删除。");
    case "visual-assets": {
      const db = await openLibraryDatabase();
      const transaction = db.transaction(VISUAL_ASSET_STORE, "readwrite");
      transaction.objectStore(VISUAL_ASSET_STORE).delete(id);
      await transactionDone(transaction);
      return;
    }
  }
}

export async function clearStorageCategory(category: StorageCategory): Promise<void> {
  switch (category) {
    case "groups":
      for (const record of await listLibraryGroups()) {
        await deleteLibraryGroup(record.libraryId);
      }
      return;
    case "world-drafts":
      for (const record of await listWorldDrafts()) {
        await deleteWorldDraft(record.libraryId);
      }
      return;
    case "world-archives":
      for (const record of await listWorldArchives()) {
        await deleteWorldArchive(record.libraryId);
      }
      removeLocalStorageWhere((key) => key.endsWith(":archive-id"));
      return;
    case "world-sources":
      {
        const records = await listWorldSources();
        await Promise.all(records.map((record) => assertWorldSourceCanDelete(record.libraryId)));
        for (const record of records) {
          await deleteWorldSource(record.libraryId);
        }
      }
      return;
    case "characters":
      for (const record of await listLibraryCharacters()) {
        await deleteLibraryCharacter(record.libraryId);
      }
      return;
    case "assets":
      throw new Error("资源属于群聊，应该随所属群聊一起删除。");
    case "visual-assets":
      await clearVisualAssetStore();
      return;
    case "runtime":
      removeLocalStorageWhere(isRuntimeKey);
      return;
    case "provider":
      clearProviderSettings();
      clearImageProviderSettings();
      return;
  }
}

export async function clearChatVerseStorage(options: ClearStorageOptions = {}): Promise<void> {
  const providerSettings = options.includeProviderSettings === false
    ? readProviderSettings()
    : undefined;
  const imageProviderSettings = options.includeProviderSettings === false
    ? readImageProviderSettings()
    : undefined;
  await clearStorageCategory("groups");
  await clearStorageCategory("world-drafts");
  await clearStorageCategory("world-archives");
  await clearStorageCategory("world-sources");
  await clearStorageCategory("characters");
  await clearAssetStore();
  await clearVisualAssetStore();
  removeLocalStorageWhere(isChatVerseKey);
  if (providerSettings && typeof window !== "undefined") {
    if (providerSettings.apiKey || providerSettings.baseURL || providerSettings.model || providerSettings.providerName) {
      const stored = JSON.stringify(providerSettings);
      if (typeof window !== "undefined") window.localStorage.setItem(PROVIDER_SETTINGS_KEY, stored);
    }
  }
  if (imageProviderSettings && typeof window !== "undefined") {
    if (imageProviderSettings.apiKey || imageProviderSettings.baseURL || imageProviderSettings.model) {
      window.localStorage.setItem(IMAGE_PROVIDER_SETTINGS_STORAGE_KEY, JSON.stringify(imageProviderSettings));
    }
  }
}

export function isManagedLocalStorageKey(key: string): boolean {
  return key.startsWith(CHATVERSE_KEY_PREFIX);
}

async function listAssets(): Promise<AssetRecord[]> {
  const db = await openLibraryDatabase();
  return request<AssetRecord[]>(
    db.transaction(GROUP_ASSET_STORE, "readonly")
      .objectStore(GROUP_ASSET_STORE)
      .getAll(),
  );
}

async function clearAssetStore(): Promise<void> {
  const db = await openLibraryDatabase();
  const transaction = db.transaction(GROUP_ASSET_STORE, "readwrite");
  transaction.objectStore(GROUP_ASSET_STORE).clear();
  await transactionDone(transaction);
}

async function listVisualAssets(): Promise<VisualAssetRecord[]> {
  const db = await openLibraryDatabase();
  return request<VisualAssetRecord[]>(db.transaction(VISUAL_ASSET_STORE, "readonly").objectStore(VISUAL_ASSET_STORE).getAll());
}

async function clearVisualAssetStore(): Promise<void> {
  const db = await openLibraryDatabase();
  const transaction = db.transaction(VISUAL_ASSET_STORE, "readwrite");
  transaction.objectStore(VISUAL_ASSET_STORE).clear();
  await transactionDone(transaction);
}

function createGroupCategory(
  records: LibraryGroupRecord[],
  assets: AssetRecord[],
): StorageCategorySummary {
  const assetBytes = new Map<string, number>();
  for (const asset of assets) {
    assetBytes.set(asset.libraryId, (assetBytes.get(asset.libraryId) ?? 0) + asset.blob.size);
  }
  const items = records.map((record) => ({
    id: record.libraryId,
    name: record.group.metadata.name,
    detail: `${record.group.characters.length} 位角色 · ${assetCountFor(assets, record.libraryId)} 个资源`,
    updatedAt: record.updatedAt,
    bytes: estimateBytes(record) + (assetBytes.get(record.libraryId) ?? 0),
    deletable: true,
  }));
  return category(
    "groups",
    "群聊与世界入口",
    "群聊配置、关联资源和对应的本地运行记录。",
    items,
    true,
  );
}

function createDraftCategory(records: WorldDraftRecord[]): StorageCategorySummary {
  return category(
    "world-drafts",
    "世界草稿",
    "尚未正式运行的世界创作稿和最近一次修改。",
    records.map((record) => ({
      id: record.libraryId,
      name: record.draft.metadata.name,
      detail: `${record.draft.actors.length} 位角色 · 修订 ${record.draft.revision}`,
      updatedAt: record.updatedAt,
      bytes: estimateBytes(record),
      deletable: true,
    })),
    true,
  );
}

function createArchiveCategory(records: WorldArchiveRecord[]): StorageCategorySummary {
  return category(
    "world-archives",
    "世界存档",
    "世界运行后的消息、旁白、剧情图和记忆快照。",
    records.map((record) => ({
      id: record.libraryId,
      name: record.archive.metadata.name,
      detail: `${record.archive.metadata.actorNames.length} 位角色 · ${record.archive.metadata.eventSequence} 个事件`,
      updatedAt: record.updatedAt,
      bytes: estimateBytes(record),
      deletable: true,
    })),
    true,
  );
}

export function createWorldSourceCategory(
  records: WorldSourceLibraryRecord[],
): StorageCategorySummary {
  return category(
    "world-sources",
    "世界资料源",
    "供导演按需检索的 Markdown 与纯文本资料，不会把全文直接塞进运行上下文。",
    records.map((record) => ({
      id: record.libraryId,
      name: record.bundle.metadata.name,
      detail: `revision ${record.bundle.revision} · ${record.bundle.documents.length} 篇文档 · ${record.bundle.chunks.length} 个片段`,
      updatedAt: record.updatedAt,
      bytes: estimateBytes(record),
      deletable: true,
    })),
    true,
  );
}

function createCharacterCategory(records: LibraryCharacterRecord[]): StorageCategorySummary {
  return category(
    "characters",
    "角色库",
    "可以跨世界和群聊复用的角色卡。",
    records.map((record) => ({
      id: record.libraryId,
      name: record.character.name,
      detail: record.character.description || "可复用角色卡",
      updatedAt: record.updatedAt,
      bytes: estimateBytes(record),
      deletable: true,
    })),
    true,
  );
}

function createAssetCategory(
  assets: AssetRecord[],
  groups: LibraryGroupRecord[],
): StorageCategorySummary {
  const names = new Map(groups.map((group) => [group.libraryId, group.group.metadata.name]));
  const grouped = new Map<string, { count: number; bytes: number }>();
  for (const asset of assets) {
    const current = grouped.get(asset.libraryId) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += asset.blob.size;
    grouped.set(asset.libraryId, current);
  }
  const items = [...grouped.entries()].map(([libraryId, value]) => ({
    id: libraryId,
    name: names.get(libraryId) ?? "未归属资源",
    detail: `${value.count} 个文件`,
    bytes: value.bytes,
    deletable: false,
    deletionNote: "资源会随所属群聊一起清理。",
  }));
  return category(
    "assets",
    "资源文件",
    "群聊包中的图片和其他二进制资源，不单独删除。",
    items,
    false,
    "资源会随群聊删除；孤立资源会在清空本机数据时一并清理。",
    assets.length,
  );
}

function createLocalCategories(entries: LocalStorageEntry[]): {
  runtime: StorageCategorySummary;
  provider: StorageCategorySummary;
} {
  const providerEntries = entries.filter((entry) => PROVIDER_SETTINGS_KEYS.has(entry.key));
  const runtimeEntries = entries.filter((entry) => isRuntimeKey(entry.key));
  return {
    runtime: category(
      "runtime",
      "会话恢复记录",
      "用于刷新后恢复世界和群聊的小型指针。",
      runtimeEntries.map((entry) => ({
        id: entry.key,
        name: localKeyName(entry.key),
        detail: "仅保存本地恢复标识，不包含完整世界内容",
        bytes: entry.bytes,
        deletable: true,
      })),
      true,
    ),
    provider: category(
      "provider",
      "模型连接配置",
      "只保存在当前浏览器的服务商、模型和 Key 状态。",
      providerEntries.map((entry) => ({
        id: entry.key,
        name: entry.key === IMAGE_PROVIDER_SETTINGS_STORAGE_KEY ? "图片模型连接" : "文本模型连接",
        detail: entry.key === IMAGE_PROVIDER_SETTINGS_STORAGE_KEY
          ? readImageProviderSettings().apiKey ? "已配置图片 Key（不会显示明文）" : "未配置图片 Key"
          : readProviderSettings().apiKey ? "已配置文本 Key（不会显示明文）" : "未配置文本 Key",
        bytes: entry.bytes,
        deletable: true,
      })),
      true,
    ),
  };
}

function category(
  id: StorageCategory,
  label: string,
  description: string,
  items: StorageItem[],
  canClear: boolean,
  clearNote?: string,
  countOverride?: number,
): StorageCategorySummary {
  return {
    id,
    label,
    description,
    items: items.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)),
    count: countOverride ?? items.length,
    bytes: items.reduce((sum, item) => sum + item.bytes, 0),
    canClear,
    clearNote,
  };
}

function readLocalStorageEntries(): LocalStorageEntry[] {
  if (typeof window === "undefined") return [];
  const entries: LocalStorageEntry[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !isManagedLocalStorageKey(key)) continue;
      const value = window.localStorage.getItem(key) ?? "";
      entries.push({ key, value, bytes: byteLength(key) + byteLength(value) });
    }
  } catch {
    return [];
  }
  return entries;
}

function isChatVerseKey(key: string): boolean {
  return isManagedLocalStorageKey(key);
}

function isRuntimeKey(key: string): boolean {
  return isChatVerseKey(key) && !PROVIDER_SETTINGS_KEYS.has(key);
}

function removeRuntimeStorageKey(key: string): void {
  if (!isRuntimeKey(key) || typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function removeLocalStorageWhere(predicate: (key: string) => boolean): void {
  if (typeof window === "undefined") return;
  const keys = readLocalStorageEntries()
    .map((entry) => entry.key)
    .filter(predicate);
  for (const key of keys) window.localStorage.removeItem(key);
}

function removeArchivePointers(archiveId: string): void {
  removeLocalStorageWhere((key) => {
    if (!key.endsWith(":archive-id") || typeof window === "undefined") return false;
    return window.localStorage.getItem(key) === archiveId;
  });
}

function localKeyName(key: string): string {
  if (key.endsWith(":room-id")) return "世界会话指针";
  if (key.endsWith(":archive-id")) return "世界存档关联";
  return key;
}

function assetCountFor(assets: AssetRecord[], libraryId: string): number {
  return assets.filter((asset) => asset.libraryId === libraryId).length;
}

function estimateBytes(value: unknown): number {
  try {
    return byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function byteLength(value: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(value).byteLength : value.length * 2;
}

async function readStorageEstimate(): Promise<{ usage?: number; quota?: number } | undefined> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return undefined;
  try {
    return await navigator.storage.estimate();
  } catch {
    return undefined;
  }
}

function request<T>(requestValue: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestValue.onsuccess = () => resolve(requestValue.result);
    requestValue.onerror = () => reject(requestValue.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}
