import { WORLD_SOURCE_SCHEMA_VERSION, type WorldSourceBundle, type WorldSourceValidationResult } from "./types.js";

export function isValidWorldSourceRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

export function validateWorldSourceBundle(bundle: WorldSourceBundle): WorldSourceValidationResult {
  const errors: string[] = [];
  if (bundle.schemaVersion !== WORLD_SOURCE_SCHEMA_VERSION) errors.push("Unsupported source schemaVersion");
  if (!bundle.id.trim()) errors.push("Source bundle id is required");
  if (!isValidWorldSourceRevision(bundle.revision)) errors.push("Source revision must be a positive safe integer");
  if (!bundle.metadata.name.trim()) errors.push("Source bundle name is required");

  const documentIds = new Set<string>();
  const documentPaths = new Set<string>();
  for (const document of bundle.documents) {
    if (documentIds.has(document.id)) errors.push(`Duplicate document id: ${document.id}`);
    if (documentPaths.has(document.path)) errors.push(`Duplicate document path: ${document.path}`);
    documentIds.add(document.id);
    documentPaths.add(document.path);
    if (!document.text.trim()) errors.push(`Document is empty: ${document.path}`);
    if (!document.sectionIds.length) errors.push(`Document has no sections: ${document.path}`);
  }

  const sectionIds = new Set<string>();
  const sectionById = new Map(bundle.sections.map((section) => [section.id, section]));
  for (const section of bundle.sections) {
    if (sectionIds.has(section.id)) errors.push(`Duplicate section id: ${section.id}`);
    sectionIds.add(section.id);
    if (!documentIds.has(section.documentId)) errors.push(`Section references unknown document: ${section.id}`);
    if (section.parentId && !sectionById.has(section.parentId)) errors.push(`Section references unknown parent: ${section.id}`);
    if (!section.title.trim()) errors.push(`Section title is empty: ${section.id}`);
  }

  const chunkIds = new Set<string>();
  for (const chunk of bundle.chunks) {
    if (chunkIds.has(chunk.id)) errors.push(`Duplicate chunk id: ${chunk.id}`);
    chunkIds.add(chunk.id);
    if (!documentIds.has(chunk.documentId)) errors.push(`Chunk references unknown document: ${chunk.id}`);
    if (!sectionIds.has(chunk.sectionId)) errors.push(`Chunk references unknown section: ${chunk.id}`);
    if (!chunk.text.trim()) errors.push(`Chunk is empty: ${chunk.id}`);
  }

  for (const section of bundle.sections) {
    for (const chunkId of section.chunkIds) {
      if (!chunkIds.has(chunkId)) errors.push(`Section references unknown chunk: ${chunkId}`);
    }
  }
  for (const document of bundle.documents) {
    for (const sectionId of document.sectionIds) {
      if (!sectionIds.has(sectionId)) errors.push(`Document references unknown section: ${sectionId}`);
    }
  }

  const indexChunkIds = new Set(bundle.index.documents.map((document) => document.chunkId));
  for (const chunkId of chunkIds) {
    if (!indexChunkIds.has(chunkId)) errors.push(`BM25 index misses chunk: ${chunkId}`);
  }
  for (const document of bundle.index.documents) {
    if (!chunkIds.has(document.chunkId)) errors.push(`BM25 index references unknown chunk: ${document.chunkId}`);
  }
  for (const term of bundle.index.terms) {
    if (term.documentFrequency !== term.postings.length) errors.push(`BM25 document frequency mismatch: ${term.term}`);
    for (const posting of term.postings) {
      if (!chunkIds.has(posting.chunkId)) errors.push(`BM25 posting references unknown chunk: ${posting.chunkId}`);
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function assertValidWorldSourceBundle(bundle: WorldSourceBundle): void {
  const result = validateWorldSourceBundle(bundle);
  if (!result.valid) throw new Error(`Invalid world source bundle: ${result.errors.join("; ")}`);
}
