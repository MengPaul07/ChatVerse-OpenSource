import { defineGroupCard } from "@chatverse/core";
import type { GroupCard } from "@chatverse/core";
import {
  createGroupPackageArchive,
  decodeGroupPackageArchive,
  groupPackageFileName,
  type DecodedGroupPackage,
  type GroupPackageAsset,
} from "@chatverse/group-package";

import {
  GROUP_ASSET_STORE,
  GROUP_LIBRARY_STORE,
  WORLD_ARCHIVE_STORE,
  openLibraryDatabase,
} from "./localLibraryDatabase";
import {
  groupWorldRoomStorageKey,
  linkedArchiveStorageKey,
} from "./worldStorageKeys";

export interface LibraryGroupRecord {
  libraryId: string;
  sourceGroupId?: string;
  group: GroupCard;
  createdAt: number;
  updatedAt: number;
}

interface AssetRecord {
  key: string;
  libraryId: string;
  path: string;
  blob: Blob;
}

export async function listLibraryGroups(): Promise<LibraryGroupRecord[]> {
  const db = await openDatabase();
  const records = await readAll<LibraryGroupRecord>(db.transaction(GROUP_LIBRARY_STORE, "readonly").objectStore(GROUP_LIBRARY_STORE));
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getLibraryGroup(libraryId: string): Promise<LibraryGroupRecord | undefined> {
  const db = await openDatabase();
  const record = await request<LibraryGroupRecord | undefined>(db.transaction(GROUP_LIBRARY_STORE, "readonly").objectStore(GROUP_LIBRARY_STORE).get(libraryId));
  return record ? cloneRecord(record) : undefined;
}

export async function createLibraryGroup(groupInput: GroupCard, sourceGroupId?: string): Promise<LibraryGroupRecord> {
  const now = Date.now();
  const record: LibraryGroupRecord = {
    libraryId: createLibraryId(),
    sourceGroupId,
    group: defineGroupCard(groupInput),
    createdAt: now,
    updatedAt: now,
  };
  await writeGroup(record);
  return cloneRecord(record);
}

export async function updateLibraryGroup(libraryId: string, groupInput: GroupCard): Promise<LibraryGroupRecord> {
  const existing = await getLibraryGroup(libraryId);
  if (!existing) throw new Error("Group not found in local library");
  const record: LibraryGroupRecord = {
    ...existing,
    group: defineGroupCard(groupInput),
    updatedAt: Date.now(),
  };
  await writeGroup(record);
  return cloneRecord(record);
}

/**
 * Remove a group and the local session data that belongs to that group.
 * Reusable character cards and unrelated world archives deliberately stay untouched.
 */
export async function deleteLibraryGroup(libraryId: string): Promise<void> {
  const record = await getLibraryGroup(libraryId);
  if (!record) return;

  const storageIds = new Set(
    [libraryId, record.sourceGroupId, record.group.metadata.id]
      .filter((value): value is string => Boolean(value)),
  );
  const archiveIds = new Set<string>();

  if (typeof localStorage !== "undefined") {
    for (const storageId of storageIds) {
      const archiveId = localStorage.getItem(
        linkedArchiveStorageKey(groupWorldRoomStorageKey(storageId)),
      );
      if (archiveId) archiveIds.add(archiveId);
    }
  }

  const db = await openDatabase();
  const transaction = db.transaction(
    [GROUP_LIBRARY_STORE, GROUP_ASSET_STORE, WORLD_ARCHIVE_STORE],
    "readwrite",
  );
  transaction.objectStore(GROUP_LIBRARY_STORE).delete(libraryId);
  for (const archiveId of archiveIds) {
    transaction.objectStore(WORLD_ARCHIVE_STORE).delete(archiveId);
  }

  const assets = transaction.objectStore(GROUP_ASSET_STORE);
  const cursorRequest = assets.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const asset = cursor.value as AssetRecord;
    if (asset.libraryId === libraryId) cursor.delete();
    cursor.continue();
  };

  await transactionDone(transaction);

  if (typeof localStorage !== "undefined") {
    for (const storageId of storageIds) {
      const roomKey = groupWorldRoomStorageKey(storageId);
      localStorage.removeItem(roomKey);
      localStorage.removeItem(linkedArchiveStorageKey(roomKey));
    }
  }
}

export async function importGroupPackage(archive: Uint8Array): Promise<LibraryGroupRecord> {
  const decoded = decodeGroupPackageArchive(archive);
  return installDecodedPackage(decoded);
}

export async function installDecodedPackage(decoded: DecodedGroupPackage): Promise<LibraryGroupRecord> {
  const record = await createLibraryGroup(decoded.group, decoded.group.metadata.id);
  if (decoded.assets.length) await writeAssets(record.libraryId, decoded.assets);
  return record;
}

export async function exportGroupPackage(libraryId: string): Promise<{ fileName: string; archive: Uint8Array }> {
  const record = await getLibraryGroup(libraryId);
  if (!record) throw new Error("Group not found in local library");
  const assets = await readAssets(libraryId);
  const archive = createGroupPackageArchive(record.group, assets);
  return { fileName: groupPackageFileName(record.group), archive };
}

export async function getAssetObjectUrl(libraryId: string, path: string): Promise<string | undefined> {
  const db = await openDatabase();
  const key = assetKey(libraryId, path);
  const item = await request<AssetRecord | undefined>(db.transaction(GROUP_ASSET_STORE, "readonly").objectStore(GROUP_ASSET_STORE).get(key));
  return item ? URL.createObjectURL(item.blob) : undefined;
}

async function writeGroup(record: LibraryGroupRecord): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(GROUP_LIBRARY_STORE, "readwrite");
  tx.objectStore(GROUP_LIBRARY_STORE).put(cloneRecord(record));
  await transactionDone(tx);
}

async function writeAssets(libraryId: string, assets: readonly GroupPackageAsset[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(GROUP_ASSET_STORE, "readwrite");
  for (const asset of assets) {
    const record: AssetRecord = {
      key: assetKey(libraryId, asset.path),
      libraryId,
      path: asset.path,
      blob: new Blob([asset.bytes.slice().buffer]),
    };
    tx.objectStore(GROUP_ASSET_STORE).put(record);
  }
  await transactionDone(tx);
}

async function readAssets(libraryId: string): Promise<GroupPackageAsset[]> {
  const db = await openDatabase();
  const all = await readAll<AssetRecord>(db.transaction(GROUP_ASSET_STORE, "readonly").objectStore(GROUP_ASSET_STORE));
  return Promise.all(all.filter((asset) => asset.libraryId === libraryId).map(async (asset) => ({
    path: asset.path,
    bytes: new Uint8Array(await asset.blob.arrayBuffer()),
  })));
}

function openDatabase(): Promise<IDBDatabase> {
  return openLibraryDatabase();
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}

function readAll<T>(store: IDBObjectStore): Promise<T[]> {
  return request(store.getAll()) as Promise<T[]>;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function createLibraryId(): string {
  return crypto.randomUUID?.() ?? `group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function assetKey(libraryId: string, path: string): string {
  return `${libraryId}:${path}`;
}

function cloneRecord(record: LibraryGroupRecord): LibraryGroupRecord {
  return structuredClone(record);
}
