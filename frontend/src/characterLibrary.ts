import type {
  CharacterCard,
  WorldAiActorDefinition,
} from "@chatverse/core";
import {
  CHARACTER_LIBRARY_STORE,
  openLibraryDatabase,
} from "./localLibraryDatabase";
const CHARACTER_PACKAGE_KIND = "chatverse.character";
const CHARACTER_PACKAGE_SCHEMA_VERSION = 1;

export interface LibraryCharacterRecord {
  libraryId: string;
  sourceCharacterName?: string;
  character: CharacterCard;
  createdAt: number;
  updatedAt: number;
}

interface CharacterPackage {
  kind: typeof CHARACTER_PACKAGE_KIND;
  schemaVersion: typeof CHARACTER_PACKAGE_SCHEMA_VERSION;
  character: CharacterCard;
}

export async function listLibraryCharacters(): Promise<LibraryCharacterRecord[]> {
  const db = await openDatabase();
  const records = await request<LibraryCharacterRecord[]>(db.transaction(CHARACTER_LIBRARY_STORE, "readonly").objectStore(CHARACTER_LIBRARY_STORE).getAll());
  return records.map(cloneRecord).sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function createLibraryCharacter(input: CharacterCard): Promise<LibraryCharacterRecord> {
  const now = Date.now();
  const record: LibraryCharacterRecord = {
    libraryId: createLibraryId(),
    sourceCharacterName: input.name,
    character: normalizeCharacter(input),
    createdAt: now,
    updatedAt: now,
  };
  await writeRecord(record);
  return cloneRecord(record);
}

export async function updateLibraryCharacter(libraryId: string, input: CharacterCard): Promise<LibraryCharacterRecord> {
  const db = await openDatabase();
  const store = db.transaction(CHARACTER_LIBRARY_STORE, "readonly").objectStore(CHARACTER_LIBRARY_STORE);
  const existing = await request<LibraryCharacterRecord | undefined>(store.get(libraryId));
  if (!existing) throw new Error("找不到这张角色卡。");
  const record: LibraryCharacterRecord = {
    ...existing,
    character: normalizeCharacter(input),
    updatedAt: Date.now(),
  };
  await writeRecord(record);
  return cloneRecord(record);
}

export async function deleteLibraryCharacter(libraryId: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(CHARACTER_LIBRARY_STORE, "readwrite");
  tx.objectStore(CHARACTER_LIBRARY_STORE).delete(libraryId);
  await transactionDone(tx);
}

export function exportCharacterPackage(input: CharacterCard): { fileName: string; contents: string } {
  const payload: CharacterPackage = {
    kind: CHARACTER_PACKAGE_KIND,
    schemaVersion: CHARACTER_PACKAGE_SCHEMA_VERSION,
    character: normalizeCharacter(input),
  };
  return {
    fileName: `${slugify(payload.character.name || "chatverse-character")}.chatverse-character.json`,
    contents: JSON.stringify(payload, null, 2),
  };
}

export function decodeCharacterPackage(contents: string): CharacterCard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("角色卡文件不是有效 JSON。");
  }
  if (!isRecord(parsed) || parsed.kind !== CHARACTER_PACKAGE_KIND || parsed.schemaVersion !== CHARACTER_PACKAGE_SCHEMA_VERSION || !isRecord(parsed.character)) {
    throw new Error("这不是支持的 ChatVerse 角色卡文件。");
  }
  return normalizeCharacter(parsed.character as Partial<CharacterCard>);
}

export function createEmptyCharacter(): CharacterCard {
  return normalizeCharacter({ name: "新角色" });
}

/**
 * Creates a world-local Actor identity from a reusable character template.
 * The library ID is intentionally not reused: one character card may appear in
 * several worlds without sharing runtime state or memory.
 */
export function createWorldActorFromCharacter(
  input: CharacterCard,
): WorldAiActorDefinition {
  const character = normalizeCharacter(input);
  return {
    id: createWorldActorId(character.name),
    kind: "character",
    card: character,
  };
}

function normalizeCharacter(input: Partial<CharacterCard>): CharacterCard {
  return {
    name: input.name?.trim() || "未命名角色",
    description: input.description ?? "",
    personality: input.personality ?? "",
    scenario: input.scenario ?? "",
    messageExample: input.messageExample ?? "",
    instructions: input.instructions,
    loreBook: input.loreBook,
    visual: input.visual ? structuredClone(input.visual) : undefined,
  };
}

async function writeRecord(record: LibraryCharacterRecord): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(CHARACTER_LIBRARY_STORE, "readwrite");
  tx.objectStore(CHARACTER_LIBRARY_STORE).put(cloneRecord(record));
  await transactionDone(tx);
}

function openDatabase(): Promise<IDBDatabase> {
  return openLibraryDatabase();
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("本地角色库读取失败。"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("本地角色库写入失败。"));
    tx.onabort = () => reject(tx.error ?? new Error("本地角色库写入已取消。"));
  });
}

function createLibraryId(): string {
  return crypto.randomUUID?.() ?? `character_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createWorldActorId(name: string): string {
  const identity = crypto.randomUUID?.()
    ?? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `actor_${slugify(name)}_${identity}`;
}

function cloneRecord(record: LibraryCharacterRecord): LibraryCharacterRecord {
  return structuredClone(record);
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "chatverse-character";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
