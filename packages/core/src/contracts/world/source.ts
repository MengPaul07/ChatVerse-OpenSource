export type WorldSourceAdherence = "follow" | "adapt" | "diverge";

export type WorldSourceFidelity = "strict" | "reference" | "free";

export interface WorldSourceBinding {
  bundleId: string;
  revision: number;
  fidelity: WorldSourceFidelity;
}

export interface WorldSourceCatalogItem {
  bundleId: string;
  revision: number;
  name: string;
  description?: string;
  documentCount: number;
  sectionCount: number;
  chunkCount: number;
}

export interface WorldSourceOutlineItem {
  id: string;
  bundleId: string;
  documentId: string;
  parentId?: string;
  title: string;
  level: number;
  summary?: string;
  tags?: string[];
  /** Total chunks in the section; chunkIds is only a bounded preview. */
  chunkCount: number;
  chunkIds: string[];
}

export interface WorldSourceSearchHit {
  chunkId: string;
  bundleId: string;
  documentId: string;
  sectionId: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface WorldSourceChunkView {
  id: string;
  bundleId: string;
  documentId: string;
  sectionId: string;
  title: string;
  text: string;
}

/**
 * Runtime retrieval boundary for large authoring sources. Implementations may
 * use IndexedDB, an in-memory bundle, or a remote store; Core never reads files.
 */
export interface WorldSourceProvider {
  validate(bindings: readonly WorldSourceBinding[]): string[];
  catalog(bindings: readonly WorldSourceBinding[]): WorldSourceCatalogItem[];
  outline(binding: WorldSourceBinding, limit: number): WorldSourceOutlineItem[];
  search(binding: WorldSourceBinding, query: string, limit: number): WorldSourceSearchHit[];
  read(binding: WorldSourceBinding, chunkIds: readonly string[]): WorldSourceChunkView[];
}
