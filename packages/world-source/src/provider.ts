import type {
  WorldSourceBinding,
  WorldSourceCatalogItem,
  WorldSourceChunkView,
  WorldSourceOutlineItem,
  WorldSourceProvider as CoreWorldSourceProvider,
  WorldSourceSearchHit,
} from "@chatverse/core";
import { searchBm25 } from "./bm25.js";
import { assertValidWorldSourceBundle, validateWorldSourceBundle } from "./validate.js";
import type {
  WorldSourceBundle,
  WorldSourceProviderOptions,
  WorldSourceProviderSnapshot,
} from "./types.js";

const MAX_OUTLINE_CHUNK_IDS = 12;

export class InMemoryWorldSourceProvider implements CoreWorldSourceProvider {
  private readonly bundles = new Map<string, WorldSourceBundle>();

  constructor(options: WorldSourceProviderOptions = {}) {
    for (const bundle of options.bundles ?? []) this.register(bundle);
  }

  register(bundle: WorldSourceBundle): void {
    assertValidWorldSourceBundle(bundle);
    this.bundles.set(bundleKey(bundle.id, bundle.revision), bundle);
  }

  remove(bundleId: string, revision: number): boolean {
    return this.bundles.delete(bundleKey(bundleId, revision));
  }

  get(bundleId: string, revision: number): WorldSourceBundle | undefined {
    return this.bundles.get(bundleKey(bundleId, revision));
  }

  snapshot(): WorldSourceProviderSnapshot {
    return { bundles: [...this.bundles.values()] };
  }

  validate(bindings: readonly WorldSourceBinding[]): string[] {
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const binding of bindings) {
      const key = bundleKey(binding.bundleId, binding.revision);
      if (seen.has(key)) errors.push(`Duplicate source binding: ${key}`);
      seen.add(key);
      const bundle = this.bundles.get(key);
      if (!bundle) {
        errors.push(`Source bundle is unavailable: ${key}`);
        continue;
      }
      const result = validateWorldSourceBundle(bundle);
      errors.push(...result.errors);
    }
    return [...new Set(errors)];
  }

  catalog(bindings: readonly WorldSourceBinding[]): WorldSourceCatalogItem[] {
    return bindings.flatMap((binding) => {
      const bundle = this.bundles.get(bundleKey(binding.bundleId, binding.revision));
      if (!bundle) return [];
      return [{
        bundleId: bundle.id,
        revision: bundle.revision,
        name: bundle.metadata.name,
        ...(bundle.metadata.description ? { description: bundle.metadata.description } : {}),
        documentCount: bundle.documents.length,
        sectionCount: bundle.sections.length,
        chunkCount: bundle.chunks.length,
      }];
    });
  }

  outline(binding: WorldSourceBinding, limit: number): WorldSourceOutlineItem[] {
    const bundle = this.requireBundle(binding);
    if (limit <= 0) return [];
    const documentOrder = new Map(bundle.documents.map((document, index) => [document.id, index]));
    const sectionOrder = new Map(bundle.sections.map((section, index) => [section.id, index]));
    return [...bundle.sections]
      .sort((left, right) => (documentOrder.get(left.documentId) ?? 0) - (documentOrder.get(right.documentId) ?? 0)
        || (sectionOrder.get(left.id) ?? 0) - (sectionOrder.get(right.id) ?? 0))
      .slice(0, limit)
      .map((section) => ({
        id: section.id,
        bundleId: bundle.id,
        documentId: section.documentId,
        ...(section.parentId ? { parentId: section.parentId } : {}),
        title: section.title,
        level: section.level,
        ...(section.summary ? { summary: section.summary } : {}),
        ...(section.tags ? { tags: [...section.tags] } : {}),
        chunkCount: section.chunkIds.length,
        chunkIds: section.chunkIds.slice(0, MAX_OUTLINE_CHUNK_IDS),
      }));
  }

  search(binding: WorldSourceBinding, query: string, limit: number): WorldSourceSearchHit[] {
    const bundle = this.requireBundle(binding);
    const sectionById = new Map(bundle.sections.map((section) => [section.id, section]));
    const documentById = new Map(bundle.documents.map((document) => [document.id, document]));
    const chunkById = new Map(bundle.chunks.map((chunk) => [chunk.id, chunk]));
    return searchBm25(bundle.index, query, limit).flatMap((result) => {
      const chunk = chunkById.get(result.chunkId);
      const section = chunk ? sectionById.get(chunk.sectionId) : undefined;
      const document = chunk ? documentById.get(chunk.documentId) : undefined;
      if (!chunk || !section || !document) return [];
      return [{
        chunkId: chunk.id,
        bundleId: bundle.id,
        documentId: document.id,
        sectionId: section.id,
        title: section.title,
        excerpt: createExcerpt(chunk.text, query),
        score: result.score,
      }];
    });
  }

  read(binding: WorldSourceBinding, chunkIds: readonly string[]): WorldSourceChunkView[] {
    const bundle = this.requireBundle(binding);
    const sectionById = new Map(bundle.sections.map((section) => [section.id, section]));
    const chunkById = new Map(bundle.chunks.map((chunk) => [chunk.id, chunk]));
    const seen = new Set<string>();
    return chunkIds.flatMap((chunkId) => {
      if (seen.has(chunkId)) return [];
      seen.add(chunkId);
      const chunk = chunkById.get(chunkId);
      const section = chunk ? sectionById.get(chunk.sectionId) : undefined;
      if (!chunk || !section) return [];
      return [{
        id: chunk.id,
        bundleId: bundle.id,
        documentId: chunk.documentId,
        sectionId: chunk.sectionId,
        title: section.title,
        text: chunk.text,
      }];
    });
  }

  private requireBundle(binding: WorldSourceBinding): WorldSourceBundle {
    const bundle = this.bundles.get(bundleKey(binding.bundleId, binding.revision));
    if (!bundle) throw new Error(`Source bundle is unavailable: ${binding.bundleId}@${binding.revision}`);
    return bundle;
  }
}

function bundleKey(id: string, revision: number): string {
  return `${id}@${revision}`;
}

function createExcerpt(text: string, query: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= 240) return compact;
  const queryToken = query.trim().split(/\s+/u)[0] ?? "";
  const position = queryToken ? compact.toLocaleLowerCase().indexOf(queryToken.toLocaleLowerCase()) : -1;
  const start = position > 80 ? position - 80 : 0;
  const excerpt = compact.slice(start, start + 240);
  return `${start > 0 ? "..." : ""}${excerpt}${start + 240 < compact.length ? "..." : ""}`;
}
