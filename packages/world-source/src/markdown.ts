import { stableId } from "./hash.js";
import type {
  WorldSourceDocument,
  WorldSourceDocumentInput,
  WorldSourceSection,
} from "./types.js";

export interface ParsedDocument {
  document: WorldSourceDocument;
  sections: ParsedSection[];
}

export interface ParsedSection extends Omit<WorldSourceSection, "bundleId" | "chunkIds"> {
  body: string;
  bodyStart: number;
  bodyEnd: number;
}

interface HeadingMatch {
  level: number;
  title: string;
  start: number;
  end: number;
}

export function parseSourceDocument(input: WorldSourceDocumentInput): ParsedDocument {
  const path = normalizePath(input.path);
  const text = normalizeText(input.content);
  const format = input.format ?? inferFormat(path);
  const title = cleanTitle(input.title) || inferTitle(text, path);
  const id = stableId("doc", `${input.id?.trim() || path}`);
  const headings = format === "markdown" ? parseHeadings(text) : [];
  const parsedSections = buildSections(id, title, text, headings);
  const document: WorldSourceDocument = {
    id,
    path,
    title,
    format,
    text,
    sectionIds: parsedSections.map((section) => section.id),
  };
  return { document, sections: parsedSections };
}

export function inferFormat(path: string): "markdown" | "text" {
  const lower = path.toLocaleLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt")) return "text";
  throw new Error(`Unsupported source format: ${path}`);
}

export function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").trim();
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Invalid source path: ${path}`);
  }
  return normalized;
}

function normalizeText(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC");
}

function parseHeadings(text: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (match) {
      headings.push({
        level: match[1]!.length,
        title: match[2]!.trim(),
        start: lineStart,
        end: newline < 0 ? lineEnd : newline + 1,
      });
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return headings;
}

function buildSections(
  documentId: string,
  documentTitle: string,
  text: string,
  headings: readonly HeadingMatch[],
): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const counters = new Map<string, number>();
  const stack: Array<{ level: number; path: number[]; section: ParsedSection }> = [];

  if (headings.length === 0) {
    sections.push(createSection(documentId, "root", documentTitle, 0, 1, text, 0, text.length));
    return sections;
  }

  const preamble = text.slice(0, headings[0]!.start);
  if (preamble.trim()) {
    const root = createSection(documentId, "root", documentTitle, 0, 1, text, 0, headings[0]!.start);
    sections.push(root);
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) stack.pop();
    const parentPath = stack[stack.length - 1]?.path ?? [];
    const parentKey = parentPath.join("/") || "root";
    const ordinal = (counters.get(parentKey) ?? 0) + 1;
    counters.set(parentKey, ordinal);
    const path = [...parentPath, ordinal];
    const pathKey = path.join("/");
    // Hierarchy belongs to the outline. Body text belongs only to the heading
    // immediately above it, otherwise parent sections duplicate every child
    // section in chunks and in the search index.
    const nextBoundary = headings[index + 1]?.start ?? text.length;
    const section = createSection(
      documentId,
      pathKey,
      heading.title,
      heading.level,
      ordinal,
      text,
      heading.end,
      nextBoundary,
      stack[stack.length - 1]?.section.id,
    );
    sections.push(section);
    stack.push({ level: heading.level, path, section });
  }

  if (sections.length === 0) {
    sections.push(createSection(documentId, "root", documentTitle, 0, 1, text, 0, text.length));
  }
  return sections;
}

function createSection(
  documentId: string,
  path: string,
  title: string,
  level: number,
  ordinal: number,
  sourceText: string,
  bodyStart: number,
  bodyEnd: number,
  parentId?: string,
): ParsedSection {
  const body = sourceText.slice(bodyStart, bodyEnd).trim();
  return {
    id: stableId("section", `${documentId}|${path}|${title}`),
    documentId,
    ...(parentId ? { parentId } : {}),
    title,
    level,
    ordinal,
    body,
    bodyStart,
    bodyEnd,
  };
}

function inferTitle(text: string, path: string): string {
  const heading = parseHeadings(text)[0]?.title;
  if (heading) return heading;
  const filename = path.split("/").at(-1) ?? path;
  return filename.replace(/\.(?:markdown?|txt)$/iu, "") || "Untitled source";
}

function cleanTitle(value: string | undefined): string {
  return value?.trim() ?? "";
}
