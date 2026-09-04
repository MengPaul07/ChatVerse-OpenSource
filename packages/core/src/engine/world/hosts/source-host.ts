import type { CreateWorldOptions, WorldDefinition } from "../../../contracts/world.js";

type SourceBinding = NonNullable<WorldDefinition["sources"]>[number];

export class WorldSourceHost {
  constructor(
    private readonly bindings: readonly SourceBinding[],
    private readonly provider: CreateWorldOptions["sourceProvider"],
  ) {}

  hasBinding(bundleId: string): boolean {
    return Boolean(this.binding(bundleId));
  }

  bindingRevision(bundleId: string): number | undefined {
    return this.binding(bundleId)?.revision;
  }

  retrieve(bundleId: string, query: string, limit: number): {
    chunkIds: string[];
    content: string;
  } {
    const binding = this.binding(bundleId);
    if (!binding || !this.provider) {
      return { chunkIds: [], content: "(Source unavailable)" };
    }
    const hits = this.provider.search(binding, query, limit);
    const chunkIds = hits.map((hit) => hit.chunkId);
    const content = this.provider.read(binding, chunkIds)
      .map((chunk) => `[${chunk.id}] ${chunk.title}\n${chunk.text}`)
      .join("\n\n") || "(no Source matches)";
    return { chunkIds, content };
  }

  validateChunkIds(bundleId: string, chunkIds: readonly string[]): boolean {
    const binding = this.binding(bundleId);
    if (!binding || !this.provider || chunkIds.length === 0) return false;
    const chunks = this.provider.read(binding, chunkIds);
    return chunks.length === new Set(chunkIds).size && chunks.every((chunk) => (
      chunk.bundleId === bundleId && chunkIds.includes(chunk.id)
    ));
  }

  private binding(bundleId: string): SourceBinding | undefined {
    return this.bindings.find((binding) => binding.bundleId === bundleId);
  }
}
