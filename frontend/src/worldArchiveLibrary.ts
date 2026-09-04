import type { WorldArchive } from "@chatverse/core";
import {
  WORLD_ARCHIVE_STORE,
  VISUAL_ASSET_STORE,
  openLibraryDatabase,
} from "./localLibraryDatabase";

export interface WorldArchiveRecord {
  /** Stable local key. It intentionally follows archiveId across room restores. */
  libraryId: string;
  archive: WorldArchive;
  createdAt: number;
  updatedAt: number;
  lastRoomId?: string;
  source?: {
    kind: "world_draft";
    draftLibraryId: string;
    draftRevision: number;
  };
}

export async function listWorldArchives(): Promise<WorldArchiveRecord[]> {
  const db = await openLibraryDatabase();
  const records = await request<WorldArchiveRecord[]>(
    db.transaction(WORLD_ARCHIVE_STORE, "readonly")
      .objectStore(WORLD_ARCHIVE_STORE)
      .getAll(),
  );
  return records
    .map(cloneRecord)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Return the latest playable save for each world definition while keeping older records in IndexedDB. */
export function latestWorldArchives(records: WorldArchiveRecord[]): WorldArchiveRecord[] {
  const latestByWorld = new Map<string, WorldArchiveRecord>();
  for (const record of [...records].sort((left, right) => right.updatedAt - left.updatedAt)) {
    const identity = archiveDefinitionIdentity(record);
    if (!latestByWorld.has(identity)) {
      latestByWorld.set(identity, record);
    }
  }
  return [...latestByWorld.values()];
}

export async function getWorldArchive(
  libraryId: string,
): Promise<WorldArchiveRecord | undefined> {
  const db = await openLibraryDatabase();
  const record = await request<WorldArchiveRecord | undefined>(
    db.transaction(WORLD_ARCHIVE_STORE, "readonly")
      .objectStore(WORLD_ARCHIVE_STORE)
      .get(libraryId),
  );
  return record ? cloneRecord(record) : undefined;
}

export async function saveWorldArchive(
  archive: WorldArchive,
  lastRoomId?: string,
  source?: WorldArchiveRecord["source"],
): Promise<WorldArchiveRecord> {
  validateArchive(archive);
  const existing = await getWorldArchive(archive.archiveId);
  const now = Date.now();
  const storedArchive = structuredClone(archive);
  storedArchive.metadata.coverImage ??= existing?.archive.metadata.coverImage;
  const record: WorldArchiveRecord = {
    libraryId: archive.archiveId,
    archive: storedArchive,
    createdAt: existing?.createdAt ?? archive.metadata.createdAt ?? now,
    updatedAt: now,
    lastRoomId,
    source: source ?? existing?.source,
  };
  const db = await openLibraryDatabase();
  const transaction = db.transaction(WORLD_ARCHIVE_STORE, "readwrite");
  transaction.objectStore(WORLD_ARCHIVE_STORE).put(cloneRecord(record));
  await transactionDone(transaction);
  return cloneRecord(record);
}

export async function deleteWorldArchive(libraryId: string): Promise<void> {
  const db = await openLibraryDatabase();
  const transaction = db.transaction([WORLD_ARCHIVE_STORE, VISUAL_ASSET_STORE], "readwrite");
  transaction.objectStore(WORLD_ARCHIVE_STORE).delete(libraryId);
  const visualStore = transaction.objectStore(VISUAL_ASSET_STORE);
  const visualRequest = visualStore.getAll();
  visualRequest.onsuccess = () => {
    for (const asset of visualRequest.result as Array<{ id: string; archiveId?: string }>) {
      if (asset.archiveId === libraryId) visualStore.delete(asset.id);
    }
  };
  await transactionDone(transaction);
}

function validateArchive(archive: WorldArchive): void {
  if (
    archive.schemaVersion !== 1 ||
    !archive.archiveId ||
    !archive.worldId ||
    archive.definition.metadata.id !== archive.worldId ||
    archive.snapshot.worldId !== archive.worldId ||
    archive.snapshot.eventSequence !== archive.metadata.eventSequence
  ) {
    throw new Error("世界存档结构无效或版本不受支持。");
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("IndexedDB transaction failed"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("IndexedDB transaction aborted"),
    );
  });
}

function cloneRecord(record: WorldArchiveRecord): WorldArchiveRecord {
  return structuredClone(record);
}

function archiveDefinitionIdentity(record: WorldArchiveRecord): string {
  if (record.source?.draftLibraryId) return `draft:${record.source.draftLibraryId}`;
  const metadata = record.archive.metadata;
  return [metadata.name, metadata.description, metadata.actorNames.join("\u001f")].join("\u001e");
}
