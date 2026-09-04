import type { TokenUsageRecord } from "./world/types";

const DATABASE_NAME = "chatverse-token-usage";
const DATABASE_VERSION = 1;
const STORE_NAME = "usage-records";
const PREFERENCES_KEY = "chatverse:token-usage-preferences:v1";

export interface TokenUsagePreferences {
  enabled: boolean;
  retentionDays: 90 | 180 | 365 | 0;
}

const DEFAULT_PREFERENCES: TokenUsagePreferences = {
  enabled: true,
  retentionDays: 180,
};

let lastRetentionCleanupAt = 0;

export function readTokenUsagePreferences(): TokenUsagePreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null") as Partial<TokenUsagePreferences> | null;
    const retention = value?.retentionDays;
    return {
      enabled: value?.enabled !== false,
      retentionDays: retention === 90 || retention === 180 || retention === 365 || retention === 0
        ? retention
        : DEFAULT_PREFERENCES.retentionDays,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveTokenUsagePreferences(input: TokenUsagePreferences): TokenUsagePreferences {
  const preferences: TokenUsagePreferences = {
    enabled: input.enabled,
    retentionDays: input.retentionDays,
  };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  return preferences;
}

export async function saveTokenUsageRecord(record: TokenUsageRecord): Promise<void> {
  const preferences = readTokenUsagePreferences();
  if (!preferences.enabled) return;
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(structuredClone(record));
  await transactionDone(transaction);
  const now = Date.now();
  if (preferences.retentionDays > 0 && now - lastRetentionCleanupAt >= 86_400_000) {
    lastRetentionCleanupAt = now;
    await deleteTokenUsageBefore(now - preferences.retentionDays * 86_400_000);
  }
}

export async function listTokenUsageRecords(input: { from?: number; to?: number } = {}): Promise<TokenUsageRecord[]> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const records = input.from !== undefined || input.to !== undefined
    ? await request<TokenUsageRecord[]>(store.index("occurredAt").getAll(IDBKeyRange.bound(
        input.from ?? 0,
        input.to ?? Number.MAX_SAFE_INTEGER,
      )))
    : await request<TokenUsageRecord[]>(store.getAll());
  return records.sort((left, right) => right.occurredAt - left.occurredAt);
}

export async function clearTokenUsageRecords(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();
  await transactionDone(transaction);
}

export async function deleteTokenUsageBefore(timestamp: number): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const index = transaction.objectStore(STORE_NAME).index("occurredAt");
  const cursorRequest = index.openKeyCursor(IDBKeyRange.upperBound(timestamp, true));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
    cursor.continue();
  };
  await transactionDone(transaction);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (db.objectStoreNames.contains(STORE_NAME)) return;
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("occurredAt", "occurredAt");
      store.createIndex("worldId", "worldId");
      store.createIndex("model", "model");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("无法打开本地 Token 账本。"));
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("本地 Token 账本操作失败。"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本地 Token 账本写入失败。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本地 Token 账本写入已取消。"));
  });
}
