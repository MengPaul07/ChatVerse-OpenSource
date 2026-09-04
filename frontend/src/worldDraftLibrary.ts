import type { WorldDraft } from "@chatverse/world-authoring";
import {
  WORLD_DRAFT_STORE,
  openLibraryDatabase,
} from "./localLibraryDatabase";

export interface WorldDraftRecord {
  libraryId: string;
  draft: WorldDraft;
  sourceGroupLibraryId?: string;
  sourceTemplateId?: string;
  createdAt: number;
  updatedAt: number;
}

export async function listWorldDrafts(): Promise<WorldDraftRecord[]> {
  const db = await openLibraryDatabase();
  const records = await request<WorldDraftRecord[]>(
    db.transaction(WORLD_DRAFT_STORE, "readonly")
      .objectStore(WORLD_DRAFT_STORE)
      .getAll(),
  );
  return records
    .map(cloneRecord)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getWorldDraft(
  libraryId: string,
): Promise<WorldDraftRecord | undefined> {
  const db = await openLibraryDatabase();
  const record = await request<WorldDraftRecord | undefined>(
    db.transaction(WORLD_DRAFT_STORE, "readonly")
      .objectStore(WORLD_DRAFT_STORE)
      .get(libraryId),
  );
  return record ? cloneRecord(record) : undefined;
}

export async function createWorldDraft(
  draft: WorldDraft,
  sourceGroupLibraryId?: string,
  sourceTemplateId?: string,
): Promise<WorldDraftRecord> {
  const now = Date.now();
  const record: WorldDraftRecord = {
    libraryId: crypto.randomUUID(),
    draft: structuredClone(draft),
    sourceGroupLibraryId,
    sourceTemplateId,
    createdAt: now,
    updatedAt: now,
  };
  await writeRecord(record);
  return cloneRecord(record);
}

export async function updateWorldDraft(
  libraryId: string,
  draft: WorldDraft,
): Promise<WorldDraftRecord> {
  const current = await getWorldDraft(libraryId);
  if (!current) throw new Error("找不到这个世界草稿。");
  const record: WorldDraftRecord = {
    ...current,
    draft: structuredClone(draft),
    updatedAt: Date.now(),
  };
  await writeRecord(record);
  return cloneRecord(record);
}

export async function deleteWorldDraft(libraryId: string): Promise<void> {
  const db = await openLibraryDatabase();
  const transaction = db.transaction(WORLD_DRAFT_STORE, "readwrite");
  transaction.objectStore(WORLD_DRAFT_STORE).delete(libraryId);
  await transactionDone(transaction);
}

async function writeRecord(record: WorldDraftRecord): Promise<void> {
  const db = await openLibraryDatabase();
  const tx = db.transaction(WORLD_DRAFT_STORE, "readwrite");
  tx.objectStore(WORLD_DRAFT_STORE).put(cloneRecord(record));
  await transactionDone(tx);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function cloneRecord(record: WorldDraftRecord): WorldDraftRecord {
  return structuredClone(record);
}
