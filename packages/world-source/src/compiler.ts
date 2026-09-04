import { buildBm25Index } from "./bm25.js";
import { chunkSection } from "./chunk.js";
import { parseSourceDocument } from "./markdown.js";
import { assertValidWorldSourceBundle, isValidWorldSourceRevision } from "./validate.js";
import {
  DEFAULT_CHUNK_OVERLAP_CHARS,
  DEFAULT_CHUNK_TARGET_CHARS,
  WORLD_SOURCE_SCHEMA_VERSION,
  type WorldSourceBundle,
  type WorldSourceCompileOptions,
  type WorldSourceSection,
} from "./types.js";

export function compileWorldSourceBundle(options: WorldSourceCompileOptions): WorldSourceBundle {
  const id = requiredText(options.id, "Source bundle id");
  const name = requiredText(options.name, "Source bundle name");
  const revision = options.revision ?? 1;
  if (!isValidWorldSourceRevision(revision)) {
    throw new Error("Source revision must be a positive safe integer");
  }
  const targetChars = options.chunkTargetChars ?? DEFAULT_CHUNK_TARGET_CHARS;
  const overlapChars = options.chunkOverlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS;
  validateChunkOptions(targetChars, overlapChars);
  if (!options.documents.length) throw new Error("At least one source document is required");

  const parsedDocuments = options.documents.map((document) => parseSourceDocument(document));
  const documentIds = new Set<string>();
  const documents = parsedDocuments.map(({ document }) => {
    if (documentIds.has(document.id)) throw new Error(`Duplicate source document id: ${document.id}`);
    documentIds.add(document.id);
    return document;
  });

  const sections: WorldSourceSection[] = [];
  const chunks = [];
  for (const parsed of parsedDocuments) {
    for (const section of parsed.sections) {
      const sectionChunks = chunkSection(section, id, { targetChars, overlapChars });
      const outputSection: WorldSourceSection = {
        id: section.id,
        bundleId: id,
        documentId: section.documentId,
        ...(section.parentId ? { parentId: section.parentId } : {}),
        title: section.title,
        level: section.level,
        ordinal: section.ordinal,
        chunkIds: sectionChunks.map((chunk) => chunk.id),
      };
      sections.push(outputSection);
      chunks.push(...sectionChunks);
    }
  }

  const bundle: WorldSourceBundle = {
    schemaVersion: WORLD_SOURCE_SCHEMA_VERSION,
    id,
    revision,
    metadata: {
      name,
      ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    },
    documents,
    sections,
    chunks,
    index: buildBm25Index(chunks, sections),
  };
  assertValidWorldSourceBundle(bundle);
  return bundle;
}

export function serializeWorldSourceBundle(bundle: WorldSourceBundle): string {
  assertValidWorldSourceBundle(bundle);
  return JSON.stringify(bundle);
}

export function deserializeWorldSourceBundle(serialized: string): WorldSourceBundle {
  const parsed: unknown = JSON.parse(serialized);
  if (!isWorldSourceBundle(parsed)) throw new Error("Invalid world source bundle JSON");
  assertValidWorldSourceBundle(parsed);
  return parsed;
}

function validateChunkOptions(targetChars: number, overlapChars: number): void {
  if (!Number.isInteger(targetChars) || targetChars < 800 || targetChars > 1200) {
    throw new Error("chunkTargetChars must be an integer between 800 and 1200");
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= targetChars) {
    throw new Error("chunkOverlapChars must be an integer smaller than chunkTargetChars");
  }
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function isWorldSourceBundle(value: unknown): value is WorldSourceBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === WORLD_SOURCE_SCHEMA_VERSION
    && typeof candidate.id === "string"
    && typeof candidate.revision === "number"
    && typeof candidate.metadata === "object"
    && Array.isArray(candidate.documents)
    && Array.isArray(candidate.sections)
    && Array.isArray(candidate.chunks)
    && typeof candidate.index === "object";
}
