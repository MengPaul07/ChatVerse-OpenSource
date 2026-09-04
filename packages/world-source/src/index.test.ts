import { describe, expect, it } from "vitest";
import type { WorldSourceBinding } from "@chatverse/core";
import {
  compileWorldSourceBundle,
  deserializeBm25Index,
  deserializeWorldSourceBundle,
  InMemoryWorldSourceProvider,
  searchBm25,
  serializeBm25Index,
  serializeWorldSourceBundle,
  tokenizeSourceText,
  validateWorldSourceBundle,
} from "./index.js";

const binding: WorldSourceBinding = {
  bundleId: "red-cliff",
  revision: 3,
  fidelity: "reference",
};

function createBundle() {
  return compileWorldSourceBundle({
    id: binding.bundleId,
    revision: binding.revision,
    name: "赤壁档案",
    description: "用于 Source 编译器测试的多文档世界。",
    documents: [
      {
        path: "lore/overview.md",
        content: "# 赤壁档案\n\n## 江面\n\n东风尚未确定，江面有雾。\n\n## 军报\n\n三份军报互相矛盾，周瑜要求核实。",
      },
      {
        path: "characters.txt",
        title: "人物记录",
        content: "周瑜负责水军部署。诸葛亮观察风向。鲁肃负责粮船接应。",
      },
    ],
  });
}

describe("world source compiler", () => {
  it("builds hierarchical sections and deterministic ids", () => {
    const first = createBundle();
    const second = createBundle();

    expect(second.documents.map((document) => document.id)).toEqual(first.documents.map((document) => document.id));
    expect(second.sections.map((section) => section.id)).toEqual(first.sections.map((section) => section.id));
    expect(second.chunks.map((chunk) => chunk.id)).toEqual(first.chunks.map((chunk) => chunk.id));
    expect(first.sections.find((section) => section.title === "江面")?.level).toBe(2);
    expect(first.sections.find((section) => section.title === "江面")?.parentId).toBeDefined();
  });

  it("indexes nested Markdown body text only once", () => {
    const bundle = createBundle();
    const matchingChunks = bundle.chunks.filter((chunk) => chunk.text.includes("三份军报互相矛盾"));

    expect(matchingChunks).toHaveLength(1);
    expect(bundle.sections.find((section) => section.title === "赤壁档案")?.chunkIds).toEqual([]);
  });

  it("keeps long chunks bounded and overlapping", () => {
    const content = Array.from({ length: 2800 }, (_, index) => `第${index}句，江风与军报都在等待。`).join("");
    const bundle = compileWorldSourceBundle({
      id: "long-source",
      name: "长文",
      documents: [{ path: "long.txt", content }],
    });
    const chunks = bundle.chunks;
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.text.length <= 1200)).toBe(true);
    expect(chunks[0]!.text.length).toBeGreaterThanOrEqual(800);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.startOffset).toBeLessThan(chunks[index - 1]!.endOffset);
    }
  });

  it("accepts plain text and rejects unsupported formats or chunk sizes", () => {
    const bundle = compileWorldSourceBundle({
      id: "plain-source",
      name: "纯文本",
      documents: [{ path: "notes.txt", content: "这是没有 Markdown 标题的纯文本资料。" }],
    });
    expect(bundle.documents[0]?.format).toBe("text");
    expect(bundle.sections[0]?.level).toBe(0);
    expect(() => compileWorldSourceBundle({
      id: "bad-source",
      name: "错误格式",
      documents: [{ path: "notes.pdf", content: "暂不支持" }],
    })).toThrow("Unsupported source format");
    expect(() => compileWorldSourceBundle({
      id: "bad-chunks",
      name: "错误分块",
      chunkTargetChars: 700,
      documents: [{ path: "notes.txt", content: "资料" }],
    })).toThrow("between 800 and 1200");
  });

  it("requires the same positive safe revision in compile and validate", () => {
    const invalidRevisions = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN];
    for (const revision of invalidRevisions) {
      expect(() => compileWorldSourceBundle({
        id: "invalid-revision",
        revision,
        name: "无效版本",
        documents: [{ path: "notes.txt", content: "一段资料。" }],
      })).toThrow("positive safe integer");

      const result = validateWorldSourceBundle({ ...createBundle(), revision });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Source revision must be a positive safe integer");
    }

    expect(validateWorldSourceBundle({ ...createBundle(), revision: 1 }).valid).toBe(true);
    expect(validateWorldSourceBundle({ ...createBundle(), revision: Number.MAX_SAFE_INTEGER }).valid).toBe(true);
  });

  it("supports Segmenter tokenization and Chinese bigram fallback tokens", () => {
    const tokens = tokenizeSourceText("赤壁之战 Red Cliff");
    expect(tokens.some((token) => token === "赤壁" || token === "壁之" || token === "之战")).toBe(true);
    expect(tokens.some((token) => token === "red cliff" || token === "red" || token === "cliff")).toBe(true);
  });

  it("serializes and restores the BM25 index", () => {
    const bundle = createBundle();
    const restoredIndex = deserializeBm25Index(serializeBm25Index(bundle.index));
    expect(searchBm25(restoredIndex, "军报", 3)).toEqual(searchBm25(bundle.index, "军报", 3));
  });

  it("serializes and restores the complete source bundle", () => {
    const bundle = createBundle();
    const restored = deserializeWorldSourceBundle(serializeWorldSourceBundle(bundle));
    expect(restored).toEqual(bundle);
  });
});

describe("InMemoryWorldSourceProvider", () => {
  it("implements the Core retrieval boundary", () => {
    const bundle = createBundle();
    const provider = new InMemoryWorldSourceProvider({ bundles: [bundle] });
    const catalog = provider.catalog([binding]);
    const outline = provider.outline(binding, 10);
    const hits = provider.search(binding, "军报", 3);
    const read = provider.read(binding, hits.map((hit) => hit.chunkId));

    expect(catalog[0]).toMatchObject({ bundleId: "red-cliff", revision: 3, documentCount: 2 });
    expect(outline.some((item) => item.title === "江面")).toBe(true);
    expect(hits[0]?.title).toBe("军报");
    expect(read[0]?.text).toContain("军报");
    expect(provider.validate([binding])).toEqual([]);
  });

  it("keeps outline chunk previews bounded while preserving the full count", () => {
    const bundle = compileWorldSourceBundle({
      id: "outline-limit",
      revision: 1,
      name: "长章节",
      documents: [{
        path: "long.txt",
        content: Array.from({ length: 4_000 }, (_, index) => `第${index}句，江面仍在等待军报回传。`).join(""),
      }],
    });
    const outlineBinding: WorldSourceBinding = {
      bundleId: bundle.id,
      revision: bundle.revision,
      fidelity: "reference",
    };
    const provider = new InMemoryWorldSourceProvider({ bundles: [bundle] });
    const [item] = provider.outline(outlineBinding, 1);

    expect(item?.chunkCount).toBe(bundle.sections[0]?.chunkIds.length);
    expect(item?.chunkCount).toBeGreaterThan(12);
    expect(item?.chunkIds).toHaveLength(12);
    expect(item?.chunkIds).toEqual(bundle.sections[0]?.chunkIds.slice(0, 12));
  });

  it("rejects unavailable or duplicate bindings without touching other bundles", () => {
    const provider = new InMemoryWorldSourceProvider({ bundles: [createBundle()] });
    const missing = { ...binding, bundleId: "missing" };
    expect(provider.validate([missing])).toEqual(["Source bundle is unavailable: missing@3"]);
    expect(provider.validate([binding, binding])).toEqual(["Duplicate source binding: red-cliff@3"]);
    expect(provider.catalog([missing])).toEqual([]);
  });

  it("reports structural corruption before a provider can serve it", () => {
    const bundle = createBundle();
    const invalid = {
      ...bundle,
      chunks: bundle.chunks.slice(1),
    };
    const result = validateWorldSourceBundle(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("BM25 index references unknown chunk"))).toBe(true);
  });
});
