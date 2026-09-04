import { openLibraryDatabase, VISUAL_ASSET_STORE } from "./localLibraryDatabase";

export interface VisualAssetRecord {
  id: string;
  kind: "actor_portrait" | "player_portrait" | "beat_background";
  ownerId: string;
  archiveId?: string;
  beatId?: string;
  blob: Blob;
  mimeType: string;
  width?: number;
  height?: number;
  prompt: string;
  provider?: string;
  model?: string;
  createdAt: number;
}

export async function saveVisualAsset(record: VisualAssetRecord): Promise<void> {
  const db = await openLibraryDatabase();
  await transaction(db, "readwrite", (store) => store.put(record));
}

export async function getVisualAsset(id: string): Promise<VisualAssetRecord | undefined> {
  const db = await openLibraryDatabase();
  return transaction(db, "readonly", (store) => store.get(id));
}

export async function findBeatBackground(archiveId: string, beatId: string): Promise<VisualAssetRecord | undefined> {
  const db = await openLibraryDatabase();
  const records = await transaction<VisualAssetRecord[]>(db, "readonly", (store) => store.getAll());
  return records.find((record) => record.kind === "beat_background" && record.archiveId === archiveId && record.beatId === beatId);
}

export async function findActorPortrait(ownerId: string): Promise<VisualAssetRecord | undefined> {
  const db = await openLibraryDatabase();
  const records = await transaction<VisualAssetRecord[]>(db, "readonly", (store) => store.getAll());
  return records
    .filter((record) => (record.kind === "actor_portrait" || record.kind === "player_portrait") && record.ownerId === ownerId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

export async function deleteVisualAsset(id: string): Promise<void> {
  const db = await openLibraryDatabase();
  await transaction(db, "readwrite", (store) => store.delete(id));
}

function transaction<T = void>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VISUAL_ASSET_STORE, mode);
    const request = run(tx.objectStore(VISUAL_ASSET_STORE));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(request.result as T);
    tx.onerror = () => reject(tx.error);
  });
}
