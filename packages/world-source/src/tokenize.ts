type WordSegment = {
  segment: string;
  isWordLike?: boolean;
};

type SegmenterLike = {
  segment(input: string): Iterable<WordSegment>;
};

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => SegmenterLike;

const CJK_RANGE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/gu;
const LATIN_RUN = /[\p{L}\p{N}]+/gu;

export function tokenizeSourceText(text: string): string[] {
  const Segmenter = getSegmenterConstructor();
  if (Segmenter) {
    const segmenter = new Segmenter(["zh", "en"], { granularity: "word" });
    const tokens: string[] = [];
    for (const item of segmenter.segment(text)) {
      if (item.isWordLike === false) continue;
      const normalized = normalizeToken(item.segment);
      if (!normalized) continue;
      tokens.push(normalized);
      appendCjkBigrams(normalized, tokens);
    }
    return tokens;
  }
  return tokenizeWithoutSegmenter(text);
}

export function normalizeToken(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function tokenizeWithoutSegmenter(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.normalize("NFKC");
  const cjkRanges: Array<{ start: number; end: number }> = [];
  for (const match of normalized.matchAll(CJK_RUN)) {
    const start = match.index ?? 0;
    const value = match[0];
    cjkRanges.push({ start, end: start + value.length });
    appendCjkBigrams(value, tokens);
  }

  for (const match of normalized.matchAll(LATIN_RUN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (cjkRanges.some((range) => start >= range.start && end <= range.end)) continue;
    tokens.push(normalizeToken(match[0]));
  }
  return tokens.filter(Boolean);
}

function appendCjkBigrams(value: string, output: string[]): void {
  const characters = [...value].filter((character) => CJK_RANGE.test(character));
  if (characters.length === 0) return;
  if (characters.length === 1) {
    output.push(characters[0]!);
    return;
  }
  for (let index = 0; index < characters.length - 1; index += 1) {
    output.push(`${characters[index]}${characters[index + 1]}`);
  }
}

function getSegmenterConstructor(): SegmenterConstructor | undefined {
  const intl = Intl as typeof Intl & { Segmenter?: SegmenterConstructor };
  return intl.Segmenter;
}
