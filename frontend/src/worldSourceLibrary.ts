import type { WorldSourceBinding } from "@chatverse/core";
import type {
  WorldSourceDraftArtifact,
  WorldSourceMaterialDocument,
  WorldSourceMaterialOrigin,
} from "@chatverse/world-authoring";
import {
  assertValidWorldSourceBundle,
  compileWorldSourceBundle,
  type WorldSourceBundle,
  type WorldSourceDocumentInput,
} from "@chatverse/world-source";
import {
  WORLD_SOURCE_STORE,
  openLibraryDatabase,
} from "./localLibraryDatabase";
import { listWorldArchives } from "./worldArchiveLibrary";
import { listWorldDrafts } from "./worldDraftLibrary";

const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_DOCUMENTS = 128;
const MAX_SOURCE_CHUNKS = 5_000;
const MAX_SOURCE_TEXT_CHARS = 5_000_000;
const MAX_SINGLE_BUNDLE_BYTES = 48 * 1024 * 1024;
const MAX_BOUND_BUNDLES_BYTES = 64 * 1024 * 1024;

export interface WorldSourceLibraryRecord {
  libraryId: string;
  bundle: WorldSourceBundle;
  createdAt: number;
  updatedAt: number;
  origin?: WorldSourceMaterialOrigin;
}

export interface ImportWorldSourceOptions {
  name?: string;
  description?: string;
  bundleId?: string;
  revision?: number;
}

export async function listWorldSources(): Promise<WorldSourceLibraryRecord[]> {
  const db = await openLibraryDatabase();
  const records = await request<WorldSourceLibraryRecord[]>(
    db.transaction(WORLD_SOURCE_STORE, "readonly")
      .objectStore(WORLD_SOURCE_STORE)
      .getAll(),
  );
  return records
    .map(cloneRecord)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getWorldSource(
  libraryId: string,
): Promise<WorldSourceLibraryRecord | undefined> {
  const db = await openLibraryDatabase();
  const record = await request<WorldSourceLibraryRecord | undefined>(
    db.transaction(WORLD_SOURCE_STORE, "readonly")
      .objectStore(WORLD_SOURCE_STORE)
      .get(libraryId),
  );
  return record ? cloneRecord(record) : undefined;
}

export async function getWorldSourceRevision(
  bundleId: string,
  revision: number,
): Promise<WorldSourceLibraryRecord | undefined> {
  return getWorldSource(sourceRevisionKey(bundleId, revision));
}

export async function saveWorldSourceBundle(
  bundle: WorldSourceBundle,
  origin: WorldSourceMaterialOrigin = "user_import",
): Promise<WorldSourceLibraryRecord> {
  assertValidWorldSourceBundle(bundle);
  const bundleBytes = serializedBytes(bundle);
  if (bundleBytes > MAX_SINGLE_BUNDLE_BYTES) {
    throw new Error("资料源编译后超过 48MB，请拆分为多份资料源后再导入。");
  }

  const libraryId = sourceRevisionKey(bundle.id, bundle.revision);
  const db = await openLibraryDatabase();
  const transaction = db.transaction(WORLD_SOURCE_STORE, "readwrite");
  const completed = transactionDone(transaction);
  const store = transaction.objectStore(WORLD_SOURCE_STORE);
  const existing = await request<WorldSourceLibraryRecord | undefined>(store.get(libraryId));
  if (existing) {
    if (JSON.stringify(existing.bundle) !== JSON.stringify(bundle)) {
      await completed;
      throw new Error(`资料源 ${bundle.metadata.name} 的 revision ${bundle.revision} 已存在，且内容不同。`);
    }
    await completed;
    return cloneRecord(existing);
  }

  const now = Date.now();
  const record: WorldSourceLibraryRecord = {
    libraryId,
    bundle: structuredClone(bundle),
    origin,
    createdAt: now,
    updatedAt: now,
  };
  await request(store.add(cloneRecord(record)));
  await completed;
  return cloneRecord(record);
}

export async function importWorldSourceFiles(
  files: readonly File[],
  options: ImportWorldSourceOptions = {},
): Promise<WorldSourceLibraryRecord> {
  if (files.length === 0) throw new Error("请选择至少一个 Markdown 或纯文本文件。");
  if (files.length > MAX_SOURCE_DOCUMENTS) {
    throw new Error(`一份资料源最多包含 ${MAX_SOURCE_DOCUMENTS} 个文档。`);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_IMPORT_BYTES) {
    throw new Error("一次导入的资料源不能超过 12MB。");
  }

  const documents: WorldSourceDocumentInput[] = await Promise.all(
    files.map(async (file) => {
      const path = sourceFilePath(file);
      const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
      if (extension !== ".md" && extension !== ".txt") {
        throw new Error(`暂不支持 ${file.name}，请选择 .md 或 .txt 文件。`);
      }
      return {
        path,
        title: titleFromPath(path),
        format: extension === ".md" ? "markdown" : "text",
        content: await file.text(),
      };
    }),
  );
  if (documents.reduce((sum, document) => sum + document.content.length, 0) > MAX_SOURCE_TEXT_CHARS) {
    throw new Error("一份资料源的正文不能超过 500 万字符。");
  }

  const bundle = compileWorldSourceBundle({
    id: options.bundleId?.trim() || `source:${crypto.randomUUID()}`,
    revision: options.revision ?? 1,
    name: options.name?.trim() || defaultBundleName(files),
    description: options.description?.trim() || undefined,
    documents,
  });
  if (bundle.chunks.length > MAX_SOURCE_CHUNKS) {
    throw new Error(`一份资料源最多生成 ${MAX_SOURCE_CHUNKS} 个检索片段。`);
  }
  return saveWorldSourceBundle(bundle);
}

export async function materializeArchitectSourceArtifact(
  artifact: WorldSourceDraftArtifact,
): Promise<WorldSourceLibraryRecord> {
  if (artifact.mode === "revise") {
    const existing = await getWorldSourceRevision(artifact.bundleId, artifact.baseRevision ?? 0);
    if (!existing || (existing.origin ?? "user_import") !== "architect") {
      throw new Error("只能修订由创作助手创建的资料源；用户上传原文保持只读。");
    }
  }
  const bundle = compileWorldSourceBundle({
    id: artifact.bundleId,
    revision: artifact.revision,
    name: artifact.name,
    description: artifact.description,
    documents: artifact.documents.map((document) => ({
      path: document.path,
      title: document.title,
      format: "markdown" as const,
      content: document.content,
    })),
  });
  return saveWorldSourceBundle(bundle, "architect");
}

export async function reviseArchitectWorldSource(
  record: WorldSourceLibraryRecord,
  documents: readonly WorldSourceDocumentInput[],
): Promise<WorldSourceLibraryRecord> {
  if ((record.origin ?? "user_import") !== "architect") {
    throw new Error("用户上传的原始文档不可修改。请另建一份补充资料。");
  }
  if (documents.length < 1 || documents.length > 6) {
    throw new Error("一份创作助手资料需要包含 1-6 篇 Markdown 文档。");
  }
  const totalChars = documents.reduce((sum, document) => sum + document.content.length, 0);
  if (totalChars > 24_000) {
    throw new Error("创作助手资料正文总量不能超过 24,000 字符，请拆分或精简内容。");
  }
  const bundle = compileWorldSourceBundle({
    id: record.bundle.id,
    revision: record.bundle.revision + 1,
    name: record.bundle.metadata.name,
    description: record.bundle.metadata.description,
    documents,
  });
  return saveWorldSourceBundle(bundle, "architect");
}

export async function loadWorldSourceMaterials(
  bindings: readonly WorldSourceBinding[] | undefined,
): Promise<WorldSourceMaterialDocument[]> {
  if (!bindings?.length) return [];
  const materials: WorldSourceMaterialDocument[] = [];
  for (const binding of bindings) {
    const record = await getWorldSourceRevision(binding.bundleId, binding.revision);
    if (!record) continue;
    for (const document of record.bundle.documents) {
      materials.push({
        bundleId: record.bundle.id,
        revision: record.bundle.revision,
        origin: record.origin ?? "user_import",
        documentId: document.id,
        path: document.path,
        title: document.title,
        content: document.text,
      });
    }
  }
  return materials;
}

export async function loadBoundWorldSourceBundles(
  bindings: readonly WorldSourceBinding[] | undefined,
): Promise<WorldSourceBundle[]> {
  if (!bindings?.length) return [];
  const bundles: WorldSourceBundle[] = [];
  for (const binding of bindings) {
    const record = await getWorldSourceRevision(binding.bundleId, binding.revision);
    if (!record) {
      throw new Error(`本机缺少已绑定资料源 ${binding.bundleId}@${binding.revision}，请重新导入后再启动世界。`);
    }
    bundles.push(structuredClone(record.bundle));
  }
  if (serializedBytes(bundles) > MAX_BOUND_BUNDLES_BYTES) {
    throw new Error("当前世界绑定的资料源编译后超过 64MB，请减少绑定或拆分世界后再启动。");
  }
  return bundles;
}

export async function deleteWorldSource(libraryId: string): Promise<void> {
  await assertWorldSourceCanDelete(libraryId);
  const db = await openLibraryDatabase();
  const transaction = db.transaction(WORLD_SOURCE_STORE, "readwrite");
  transaction.objectStore(WORLD_SOURCE_STORE).delete(libraryId);
  await transactionDone(transaction);
}

export async function assertWorldSourceCanDelete(libraryId: string): Promise<void> {
  const record = await getWorldSource(libraryId);
  if (!record) return;
  const references = await findWorldSourceReferences(record.bundle.id, record.bundle.revision);
  if (references.length > 0) {
    throw new Error(`资料源仍被 ${references.join("、")} 引用，请先解除绑定。`);
  }
}

function sourceRevisionKey(bundleId: string, revision: number): string {
  return `${bundleId}@${revision}`;
}

async function findWorldSourceReferences(bundleId: string, revision: number): Promise<string[]> {
  const [drafts, archives] = await Promise.all([listWorldDrafts(), listWorldArchives()]);
  const matches = (bindings: readonly WorldSourceBinding[] | undefined) => (
    bindings?.some((binding) => binding.bundleId === bundleId && binding.revision === revision) ?? false
  );
  return [
    ...drafts
      .filter((record) => matches(record.draft.sources))
      .map((record) => `草稿“${record.draft.metadata.name}”`),
    ...archives
      .filter((record) => matches(record.archive.definition.sources))
      .map((record) => `存档“${record.archive.metadata.name}”`),
  ];
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function sourceFilePath(file: File): string {
  const relativePath = "webkitRelativePath" in file && file.webkitRelativePath
    ? file.webkitRelativePath
    : file.name;
  return relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
}

function titleFromPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.replace(/\.(?:md|txt)$/i, "");
}

function defaultBundleName(files: readonly File[]): string {
  if (files.length === 1) return titleFromPath(files[0]!.name);
  return `${titleFromPath(files[0]!.name)} 等 ${files.length} 篇资料`;
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
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function cloneRecord(record: WorldSourceLibraryRecord): WorldSourceLibraryRecord {
  return structuredClone(record);
}
