import { stableId } from "./hash.js";
import type { ParsedSection } from "./markdown.js";
import type { WorldSourceChunk } from "./types.js";

export interface ChunkingOptions {
  targetChars: number;
  overlapChars: number;
}

export function chunkSection(
  section: ParsedSection,
  bundleId: string,
  options: ChunkingOptions,
): WorldSourceChunk[] {
  const text = section.body;
  if (!text) return [];
  const chunks: WorldSourceChunk[] = [];
  let start = 0;
  let ordinal = 0;

  while (start < text.length) {
    const remaining = text.length - start;
    const rawEnd = remaining <= options.targetChars
      ? text.length
      : chooseBoundary(text, start, Math.min(start + options.targetChars, text.length));
    const end = Math.max(start + 1, Math.min(rawEnd, start + options.targetChars));
    const chunkText = text.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        id: stableId("chunk", `${bundleId}|${section.id}|${ordinal}|${chunkText}`),
        bundleId,
        documentId: section.documentId,
        sectionId: section.id,
        ordinal,
        startOffset: section.bodyStart + start,
        endOffset: section.bodyStart + end,
        text: chunkText,
      });
      ordinal += 1;
    }
    if (end >= text.length) break;
    const nextStart = Math.max(start + 1, end - options.overlapChars);
    start = nextStart;
  }
  return chunks;
}

function chooseBoundary(text: string, start: number, desiredEnd: number): number {
  const lowerBound = start + Math.min(800, desiredEnd - start);
  let best = -1;
  for (let index = desiredEnd - 1; index >= lowerBound; index -= 1) {
    const character = text[index];
    if (character === "\n" || character === "。" || character === "！" || character === "？" || character === "." || character === "!" || character === "?" || character === "；" || character === ";") {
      best = index + 1;
      break;
    }
  }
  return best > start ? best : desiredEnd;
}
