export const GROUP_LIBRARY_STORE = "groups";
export const GROUP_ASSET_STORE = "assets";
export const CHARACTER_LIBRARY_STORE = "characters";
export const WORLD_DRAFT_STORE = "world-drafts";
export const WORLD_ARCHIVE_STORE = "world-archives";
export const VISUAL_ASSET_STORE = "visual-assets";
export const WORLD_SOURCE_STORE = "world-sources";

const DATABASE_NAME = "chatverse-group-library";
const DATABASE_VERSION = 7;

/**
 * Group packages and reusable character cards share one local database.
 * Keeping schema creation here makes the upgrade independent of which library
 * page the user opens first.
 */
export function openLibraryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(GROUP_LIBRARY_STORE)) {
        db.createObjectStore(GROUP_LIBRARY_STORE, { keyPath: "libraryId" });
      }
      if (!db.objectStoreNames.contains(GROUP_ASSET_STORE)) {
        db.createObjectStore(GROUP_ASSET_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(CHARACTER_LIBRARY_STORE)) {
        db.createObjectStore(CHARACTER_LIBRARY_STORE, { keyPath: "libraryId" });
      }
      if (!db.objectStoreNames.contains(WORLD_DRAFT_STORE)) {
        db.createObjectStore(WORLD_DRAFT_STORE, { keyPath: "libraryId" });
      }
      if (!db.objectStoreNames.contains(WORLD_ARCHIVE_STORE)) {
        db.createObjectStore(WORLD_ARCHIVE_STORE, { keyPath: "libraryId" });
      }
      if (!db.objectStoreNames.contains(VISUAL_ASSET_STORE)) {
        const store = db.createObjectStore(VISUAL_ASSET_STORE, { keyPath: "id" });
        store.createIndex("kind", "kind");
        store.createIndex("archiveId", "archiveId");
        store.createIndex("beatId", "beatId");
      }
      if (!db.objectStoreNames.contains(WORLD_SOURCE_STORE)) {
        const store = db.createObjectStore(WORLD_SOURCE_STORE, { keyPath: "libraryId" });
        store.createIndex("bundleId", "bundle.id");
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("无法打开本地资料库。"));
  });
}
