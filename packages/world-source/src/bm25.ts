import { tokenizeSourceText } from "./tokenize.js";
import type {
  SerializedBm25Document,
  SerializedBm25Index,
  SerializedBm25Posting,
  SerializedBm25Term,
  WorldSourceChunk,
  WorldSourceSection,
} from "./types.js";

export const DEFAULT_BM25_K1 = 1.2;
export const DEFAULT_BM25_B = 0.75;

export interface Bm25SearchResult {
  chunkId: string;
  score: number;
}

export function buildBm25Index(
  chunks: readonly WorldSourceChunk[],
  sections: readonly WorldSourceSection[],
  options: { k1?: number; b?: number } = {},
): SerializedBm25Index {
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const documents: SerializedBm25Document[] = [];
  const termPostings = new Map<string, Map<string, number>>();

  for (const chunk of chunks) {
    const section = sectionById.get(chunk.sectionId);
    const searchableText = [
      section?.title ?? "",
      section?.title ?? "",
      section?.summary ?? "",
      ...(section?.tags ?? []),
      chunk.text,
    ].join("\n");
    const tokens = tokenizeSourceText(searchableText);
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    documents.push({ chunkId: chunk.id, length: tokens.length });
    for (const [term, frequency] of frequencies) {
      const postings = termPostings.get(term) ?? new Map<string, number>();
      postings.set(chunk.id, frequency);
      termPostings.set(term, postings);
    }
  }

  const sortedTerms: SerializedBm25Term[] = [...termPostings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, postings]) => {
      const serializedPostings: SerializedBm25Posting[] = [...postings.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chunkId, termFrequency]) => ({ chunkId, termFrequency }));
      return {
        term,
        documentFrequency: serializedPostings.length,
        postings: serializedPostings,
      };
    });
  const averageDocumentLength = documents.length === 0
    ? 0
    : documents.reduce((total, document) => total + document.length, 0) / documents.length;
  return {
    schemaVersion: 1,
    k1: options.k1 ?? DEFAULT_BM25_K1,
    b: options.b ?? DEFAULT_BM25_B,
    averageDocumentLength,
    documents: documents.sort((left, right) => left.chunkId.localeCompare(right.chunkId)),
    terms: sortedTerms,
  };
}

export function searchBm25(
  index: SerializedBm25Index,
  query: string,
  limit: number,
): Bm25SearchResult[] {
  if (limit <= 0) return [];
  const queryTerms = new Set(tokenizeSourceText(query));
  if (queryTerms.size === 0 || index.documents.length === 0) return [];
  const documentCount = index.documents.length;
  const scores = new Map<string, number>();
  const lengths = new Map(index.documents.map((document) => [document.chunkId, document.length]));
  const averageLength = index.averageDocumentLength || 1;

  for (const term of queryTerms) {
    const entry = index.terms.find((candidate) => candidate.term === term);
    if (!entry) continue;
    const idf = Math.log(1 + (documentCount - entry.documentFrequency + 0.5) / (entry.documentFrequency + 0.5));
    for (const posting of entry.postings) {
      const length = lengths.get(posting.chunkId) ?? averageLength;
      const denominator = posting.termFrequency + index.k1 * (1 - index.b + index.b * length / averageLength);
      const contribution = idf * (posting.termFrequency * (index.k1 + 1)) / denominator;
      scores.set(posting.chunkId, (scores.get(posting.chunkId) ?? 0) + contribution);
    }
  }

  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
    .slice(0, limit);
}

export function serializeBm25Index(index: SerializedBm25Index): string {
  return JSON.stringify(index);
}

export function deserializeBm25Index(serialized: string): SerializedBm25Index {
  const value: unknown = JSON.parse(serialized);
  if (!isSerializedBm25Index(value)) throw new Error("Invalid serialized BM25 index");
  return value;
}

function isSerializedBm25Index(value: unknown): value is SerializedBm25Index {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.k1 !== "number" || typeof value.b !== "number" || typeof value.averageDocumentLength !== "number") return false;
  if (!Array.isArray(value.documents) || !Array.isArray(value.terms)) return false;
  return value.documents.every((item) => isRecord(item) && typeof item.chunkId === "string" && typeof item.length === "number")
    && value.terms.every((item) => isRecord(item) && typeof item.term === "string" && typeof item.documentFrequency === "number" && Array.isArray(item.postings)
      && item.postings.every((posting) => isRecord(posting) && typeof posting.chunkId === "string" && typeof posting.termFrequency === "number"));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
