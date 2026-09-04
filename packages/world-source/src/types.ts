import type {
  WorldSourceBinding,
  WorldSourceCatalogItem,
  WorldSourceChunkView,
  WorldSourceOutlineItem,
  WorldSourceSearchHit,
  WorldSourceProvider,
} from "@chatverse/core";

export const WORLD_SOURCE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CHUNK_TARGET_CHARS = 1000;
export const DEFAULT_CHUNK_OVERLAP_CHARS = 120;
export const DEFAULT_SEARCH_LIMIT = 8;

export type WorldSourceDocumentFormat = "markdown" | "text";

export interface WorldSourceDocumentInput {
  /** Stable caller-owned identity. When omitted, the normalized path is used. */
  id?: string;
  path: string;
  title?: string;
  format?: WorldSourceDocumentFormat;
  content: string;
}

export interface WorldSourceCompileOptions {
  id: string;
  revision?: number;
  name: string;
  description?: string;
  documents: readonly WorldSourceDocumentInput[];
  chunkTargetChars?: number;
  chunkOverlapChars?: number;
}

export interface WorldSourceDocument {
  id: string;
  path: string;
  title: string;
  format: WorldSourceDocumentFormat;
  text: string;
  sectionIds: string[];
}

export interface WorldSourceSection {
  id: string;
  bundleId: string;
  documentId: string;
  parentId?: string;
  title: string;
  level: number;
  ordinal: number;
  summary?: string;
  tags?: string[];
  chunkIds: string[];
}

export interface WorldSourceChunk {
  id: string;
  bundleId: string;
  documentId: string;
  sectionId: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface SerializedBm25Posting {
  chunkId: string;
  termFrequency: number;
}

export interface SerializedBm25Term {
  term: string;
  documentFrequency: number;
  postings: SerializedBm25Posting[];
}

export interface SerializedBm25Document {
  chunkId: string;
  length: number;
}

export interface SerializedBm25Index {
  schemaVersion: 1;
  k1: number;
  b: number;
  averageDocumentLength: number;
  documents: SerializedBm25Document[];
  terms: SerializedBm25Term[];
}

export interface WorldSourceBundleMetadata {
  name: string;
  description?: string;
}

export interface WorldSourceBundle {
  schemaVersion: typeof WORLD_SOURCE_SCHEMA_VERSION;
  id: string;
  revision: number;
  metadata: WorldSourceBundleMetadata;
  documents: WorldSourceDocument[];
  sections: WorldSourceSection[];
  chunks: WorldSourceChunk[];
  index: SerializedBm25Index;
}

export interface WorldSourceValidationResult {
  valid: boolean;
  errors: string[];
}

export interface WorldSourceProviderOptions {
  bundles?: readonly WorldSourceBundle[];
}

export interface WorldSourceProviderSnapshot {
  bundles: WorldSourceBundle[];
}

export type {
  WorldSourceBinding,
  WorldSourceCatalogItem,
  WorldSourceChunkView,
  WorldSourceOutlineItem,
  WorldSourceSearchHit,
  WorldSourceProvider,
};
