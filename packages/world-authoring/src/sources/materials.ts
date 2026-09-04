import type { DraftIdGenerator } from "../draft.js";
import type {
  WorldSourceDraftArtifact,
  WorldSourceMaterialDocument,
} from "../types.js";
import { integer, requiredRecord, requiredString, stringArray } from "../architect/tools/parsing.js";

export function inspectSourceMaterials(
  materials: readonly WorldSourceMaterialDocument[],
  args: Record<string, unknown>,
): Record<string, unknown> {
  const bundleIds = new Set(stringArray(args.bundleIds));
  const documentIds = new Set(stringArray(args.documentIds));
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const limit = Math.max(1, Math.min(12, Number.isInteger(args.limit) ? Number(args.limit) : 8));
  const selected = materials.filter((material) => (
    (!bundleIds.size || bundleIds.has(material.bundleId))
    && (!documentIds.size || documentIds.has(material.documentId))
  ));
  if (!query) {
    return {
      documents: selected.slice(0, 128).map((material) => ({
        bundleId: material.bundleId,
        revision: material.revision,
        origin: material.origin,
        documentId: material.documentId,
        path: material.path,
        title: material.title,
        chars: material.content.length,
        lines: sourceLines(material.content).length,
      })),
      readOnlyNotice: "origin=user_import 的原始资料只能读取；需要整理时请另建资料源。",
    };
  }
  const hits: Array<Record<string, unknown>> = [];
  for (const material of selected) {
    const lines = sourceLines(material.content);
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]!.toLowerCase().includes(query)) continue;
      const startIndex = Math.max(0, index - 2);
      const endIndex = Math.min(lines.length, index + 3);
      hits.push({
        bundleId: material.bundleId,
        revision: material.revision,
        origin: material.origin,
        documentId: material.documentId,
        path: material.path,
        title: material.title,
        startLine: startIndex + 1,
        endLine: endIndex,
        excerpt: lines.slice(startIndex, endIndex).join("\n"),
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  return { query, hits, truncated: hits.length >= limit };
}

export function readSourceMaterial(
  materials: readonly WorldSourceMaterialDocument[],
  args: Record<string, unknown>,
): Record<string, unknown> {
  const documentId = requiredString(args.documentId, "documentId");
  const material = materials.find((item) => item.documentId === documentId);
  if (!material) throw new Error(`找不到资料文档：${documentId}`);
  const lines = sourceLines(material.content);
  const startLine = integer(args.startLine, "startLine");
  const requestedEndLine = integer(args.endLine, "endLine");
  if (startLine < 1 || requestedEndLine < startLine) {
    throw new Error("读取行范围无效：startLine 必须不小于 1，endLine 必须不小于 startLine。");
  }
  const endLine = Math.min(lines.length, requestedEndLine, startLine + 199);
  return {
    bundleId: material.bundleId,
    revision: material.revision,
    origin: material.origin,
    documentId: material.documentId,
    path: material.path,
    title: material.title,
    startLine,
    endLine,
    totalLines: lines.length,
    content: lines.slice(startLine - 1, endLine).join("\n"),
    truncated: requestedEndLine > endLine,
  };
}

export function parseSourceArtifact(
  args: Record<string, unknown>,
  context: {
    sourceMaterials: readonly WorldSourceMaterialDocument[];
    nextId: DraftIdGenerator;
  },
): WorldSourceDraftArtifact {
  if (!Array.isArray(args.documents) || args.documents.length < 1 || args.documents.length > 6) {
    throw new Error("documents 必须包含 1-6 篇 Markdown 文档。");
  }
  const seenPaths = new Set<string>();
  const documents = args.documents.map((value, index) => {
    const record = requiredRecord(value, `documents[${index}]`);
    let path = requiredString(record.path, `documents[${index}].path`).replaceAll("\\", "/");
    if (path.startsWith("/") || path.includes("..") || /^[A-Za-z]:/.test(path)) {
      throw new Error(`documents[${index}].path 必须是资料源内的安全相对路径。`);
    }
    if (!path.toLowerCase().endsWith(".md")) path += ".md";
    if (seenPaths.has(path)) throw new Error(`文档路径重复：${path}`);
    seenPaths.add(path);
    const content = requiredString(record.content, `documents[${index}].content`);
    if (content.length > 8000) throw new Error(`单篇 Markdown 不能超过 8000 字符：${path}`);
    if (!/^#{1,3}\s+\S/m.test(content)) throw new Error(`Markdown 文档必须包含清晰标题：${path}`);
    return {
      path,
      title: requiredString(record.title, `documents[${index}].title`).slice(0, 120),
      content,
    };
  });
  const totalChars = documents.reduce((sum, document) => sum + document.content.length, 0);
  if (totalChars > 24000) throw new Error("一次写入资料源的 Markdown 总正文不能超过 24000 字符。");

  const requestedBundleId = typeof args.bundleId === "string" ? args.bundleId.trim() : "";
  const baseRevision = Number.isInteger(args.baseRevision) ? Number(args.baseRevision) : undefined;
  if (requestedBundleId) {
    const owned = context.sourceMaterials.find((material) => (
      material.bundleId === requestedBundleId && material.revision === baseRevision
    ));
    if (!owned) throw new Error("找不到要修订的资料源版本。");
    if (owned.origin !== "architect") {
      throw new Error("用户上传的原始资料不可修改；请创建一份独立的整理或补充资料源。");
    }
  }
  const bundleId = requestedBundleId || context.nextId("world-source");
  return {
    id: context.nextId("source-artifact"),
    mode: requestedBundleId ? "revise" : "create",
    bundleId,
    ...(baseRevision !== undefined ? { baseRevision } : {}),
    revision: requestedBundleId ? (baseRevision ?? 0) + 1 : 1,
    name: requiredString(args.name, "name").slice(0, 120),
    description: typeof args.description === "string"
      ? args.description.trim().slice(0, 500) || undefined
      : undefined,
    documents,
  };
}

function sourceLines(content: string): string[] {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}
