/**
 * Ephemeral references exposed to one Director request.
 *
 * Runtime state must keep using real ids. These aliases are deliberately
 * exact and short-lived: they reduce prompt noise without giving the model a
 * fuzzy lookup path that could silently target the wrong object.
 */
export type DirectorReferenceKind =
  | "actor"
  | "context"
  | "chapter"
  | "beat"
  | "event"
  | "source";

export interface DirectorReferenceTableInput {
  actorIds: readonly string[];
  contextIds: readonly string[];
  chapterIds: readonly string[];
  beatIds: readonly string[];
  eventIds: readonly string[];
  sourceIds?: readonly string[];
}

export interface DirectorReferenceTable {
  /** Return the exact short reference for a known runtime id. */
  refFor(kind: DirectorReferenceKind, id: string): string | undefined;
  /** Resolve an exact short reference. Runtime ids and names are not accepted. */
  resolve(kind: DirectorReferenceKind, reference: string): string | undefined;
  /** Return all aliases in their deterministic prompt order. */
  refs(kind: DirectorReferenceKind): readonly string[];
  /** True for every reserved typed alias, even when it is not in this table. */
  isReservedReference(value: string): boolean;
  /** Replace known runtime ids in a diagnostic/provider projection. */
  redactKnownIds(value: string): string;
  /** Hide runtime-looking ids from model output before it is echoed in a repair prompt. */
  redactModelOutput(value: string): string;
  /** Debug-only mapping; never include this in a model message. */
  debugMapping(): Record<string, Record<string, string>>;
  /** Register chunks returned by a source lookup and get stable aliases. */
  registerSourceChunks(bundleId: string, chunkIds: readonly string[]): string[];
  sourceChunkRef(bundleId: string, chunkId: string): string | undefined;
}

const ALIAS_PREFIX: Record<DirectorReferenceKind, string> = {
  actor: "A",
  context: "C",
  chapter: "CH",
  beat: "B",
  event: "E",
  source: "S",
};

const SOURCE_CHUNK_SEPARATOR = "\u0000";

class EphemeralDirectorReferenceTable implements DirectorReferenceTable {
  private readonly refToId = new Map<DirectorReferenceKind, Map<string, string>>();
  private readonly idToRef = new Map<DirectorReferenceKind, Map<string, string>>();
  private readonly sourceChunkRefs = new Map<string, string>();
  private readonly sourceChunksByBundle = new Map<string, string[]>();

  constructor(input: DirectorReferenceTableInput) {
    for (const kind of Object.keys(ALIAS_PREFIX) as DirectorReferenceKind[]) {
      this.refToId.set(kind, new Map());
      this.idToRef.set(kind, new Map());
    }
    this.addMany("actor", input.actorIds);
    this.addMany("context", input.contextIds);
    this.addMany("chapter", input.chapterIds);
    this.addMany("beat", input.beatIds);
    this.addMany("event", input.eventIds);
    this.addMany("source", input.sourceIds ?? []);
  }

  refFor(kind: DirectorReferenceKind, id: string): string | undefined {
    return this.idToRef.get(kind)?.get(id);
  }

  resolve(kind: DirectorReferenceKind, reference: string): string | undefined {
    return this.refToId.get(kind)?.get(reference);
  }

  refs(kind: DirectorReferenceKind): readonly string[] {
    return [...(this.refToId.get(kind)?.keys() ?? [])];
  }

  isReservedReference(value: string): boolean {
    return /^(?:A|C|CH|B|E|S)\d+(?:-\d+)?$/.test(value);
  }

  redactKnownIds(value: string): string {
    let result = value;
    const replacements = [...this.allKnownIdRefs()]
      .sort((left, right) => right.id.length - left.id.length);
    for (const { kind, id, reference } of replacements) {
      if (id === reference) continue;
      result = looksLikeOpaqueId(id)
        ? result.split(id).join(reference)
        : replaceStructuredId(result, kind, id, reference);
    }
    return result;
  }

  redactModelOutput(value: string): string {
    let result = value;
    const replacements = [...this.allKnownIdRefs()]
      .sort((left, right) => right.id.length - left.id.length);
    for (const { id } of replacements) {
      if (id) result = result.split(id).join("<internal-id>");
    }
    return result
      .replace(/\b(?:world|actor|context|chapter|beat|event|source):[A-Za-z0-9._:-]+\b/g, "<internal-id>")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "<internal-id>");
  }

  debugMapping(): Record<string, Record<string, string>> {
    const mapping: Record<string, Record<string, string>> = {};
    for (const kind of Object.keys(ALIAS_PREFIX) as DirectorReferenceKind[]) {
      mapping[`${kind}s`] = Object.fromEntries(this.refToId.get(kind) ?? []);
    }
    const sourceChunks = Object.fromEntries(
      [...this.sourceChunkRefs.entries()].map(([key, reference]) => [reference, key.split(SOURCE_CHUNK_SEPARATOR).join(" / ")]),
    );
    if (Object.keys(sourceChunks).length > 0) mapping.sourceChunks = sourceChunks;
    return mapping;
  }

  registerSourceChunks(bundleId: string, chunkIds: readonly string[]): string[] {
    const sourceRef = this.refFor("source", bundleId);
    if (!sourceRef) return [];
    const known = this.sourceChunksByBundle.get(bundleId) ?? [];
    const refs: string[] = [];
    for (const chunkId of chunkIds) {
      const key = `${bundleId}${SOURCE_CHUNK_SEPARATOR}${chunkId}`;
      let reference = this.sourceChunkRefs.get(key);
      if (!reference) {
        known.push(chunkId);
        reference = `${sourceRef}-${known.length}`;
        this.sourceChunkRefs.set(key, reference);
        this.sourceChunksByBundle.set(bundleId, known);
      }
      refs.push(reference);
    }
    return refs;
  }

  sourceChunkRef(bundleId: string, chunkId: string): string | undefined {
    return this.sourceChunkRefs.get(`${bundleId}${SOURCE_CHUNK_SEPARATOR}${chunkId}`);
  }

  private addMany(kind: DirectorReferenceKind, ids: readonly string[]): void {
    const refToId = this.refToId.get(kind)!;
    const idToRef = this.idToRef.get(kind)!;
    let index = 1;
    for (const id of ids) {
      if (!id || idToRef.has(id)) continue;
      let reference = `${ALIAS_PREFIX[kind]}${index}`;
      while (refToId.has(reference)) {
        index++;
        reference = `${ALIAS_PREFIX[kind]}${index}`;
      }
      refToId.set(reference, id);
      idToRef.set(id, reference);
      index++;
    }
  }

  private *allKnownIdRefs(): Iterable<{ kind: DirectorReferenceKind; id: string; reference: string }> {
    for (const kind of Object.keys(ALIAS_PREFIX) as DirectorReferenceKind[]) {
      for (const [id, reference] of this.idToRef.get(kind) ?? []) {
        yield { kind, id, reference };
      }
    }
    for (const [key, reference] of this.sourceChunkRefs) {
      const separator = key.indexOf(SOURCE_CHUNK_SEPARATOR);
      if (separator < 0) continue;
      yield { kind: "source", id: key.slice(separator + 1), reference };
    }
  }
}

export function createDirectorReferenceTable(
  input: DirectorReferenceTableInput,
): DirectorReferenceTable {
  return new EphemeralDirectorReferenceTable(input);
}

function looksLikeOpaqueId(value: string): boolean {
  return value.includes(":") || value.includes("/") || value.includes("-") || UUID_PATTERN.test(value);
}

function replaceStructuredId(
  value: string,
  kind: DirectorReferenceKind,
  id: string,
  reference: string,
): string {
  const escaped = escapeRegExp(id);
  const keys = referenceKeys(kind);
  let result = value;
  // Replace only typed ID fields. This keeps semantic values such as
  // participantKind=player intact when an actor happens to have id "player".
  result = result.replace(
    new RegExp(`([\\"']?(?:${keys})[\\"']?\\s*[=:]\\s*[\\"']?)${escaped}([\\"']?)(?=\\s*(?:$|[,;}:]|\\]|[A-Za-z_][A-Za-z0-9_]*\\s*[=:]))`, "g"),
    `$1${reference}$2`,
  );
  result = result.replace(
    new RegExp(`((?:[\\"']?(?:${keys})[\\"']?\\s*[=:]\\s*)\\[[^\\]]*\\])`, "g"),
    (list) => list.replace(
      new RegExp(`([\\[,])([ \\t]*[\\"']?)${escaped}([\\"']?)(?=\\s*(?:,|\\]))`, "g"),
      `$1$2${reference}$3`,
    ),
  );
  return result;
}

function referenceKeys(kind: DirectorReferenceKind): string {
  switch (kind) {
    case "actor":
      return "actor|actorId|actorRef|actors|actorIds|actorRefs";
    case "context":
      return "context|contextId|contextRef|contexts|contextIds|contextRefs";
    case "chapter":
      return "chapter|chapterId|chapterRef|chapters|chapterIds|chapterRefs|foregroundChapter";
    case "beat":
      return "beat|beatId|beatRef|beats|beatIds|beatRefs|fromBeat|fromBeatId|toBeat|toBeatId";
    case "event":
      return "event|eventId|eventRef|events|eventIds|eventRefs|sourceEvent|sourceEventId|sourceEvents|sourceEventIds|sourceEventRefs";
    case "source":
      return "source|sourceId|sourceRef|sources|sourceIds|sourceRefs|bundleId|sourceBundleId|sourceChunkId|sourceChunkRefs";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
