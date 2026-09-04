import { describe, expect, it } from "vitest";
import { createEmptyWorldDraft } from "../draft.js";
import { draftIndex, inspectDraft } from "../draft/inspection.js";
import {
  AuthoringToolInputError,
  parseArgs,
  parseOperations,
} from "./tools/parsing.js";
import { worldArchitectTools } from "./tools/definitions.js";
import {
  inspectSourceMaterials,
  parseSourceArtifact,
  readSourceMaterial,
} from "../sources/materials.js";

describe("World Architect modules", () => {
  it("only exposes web research when the capability is enabled", () => {
    const names = (enabled: boolean) => worldArchitectTools(enabled)
      .map((tool) => tool.function.name);

    expect(names(false)).not.toContain("research_web");
    expect(names(true)).toContain("research_web");
    expect(names(true).filter((name) => name === "research_web")).toHaveLength(1);
  });

  it("keeps malformed tool arguments distinguishable from draft failures", () => {
    expect(() => parseArgs({
      id: "call:1",
      type: "function",
      function: { name: "save_actor", arguments: "{\"actor\":" },
    })).toThrow(AuthoringToolInputError);

    expect(() => parseOperations([{ type: "unknown_operation" }]))
      .toThrow("不是支持的草稿操作");
  });

  it("builds a compact index while allowing focused draft inspection", () => {
    const draft = createEmptyWorldDraft({ id: "draft:test", name: "测试世界" });
    const index = draftIndex(draft);
    const inspected = inspectDraft(draft, ["metadata", "contexts"], []);

    expect(index).toMatchObject({ id: "draft:test", revision: 0 });
    expect(inspected).toHaveProperty("metadata.name", "测试世界");
    expect(inspected).toHaveProperty("contexts");
    expect(inspected).not.toHaveProperty("lore");
  });

  it("keeps imported sources readable but immutable", () => {
    const materials = [{
      bundleId: "bundle:user",
      revision: 1,
      origin: "user_import" as const,
      documentId: "doc:one",
      path: "lore/history.md",
      title: "旧史",
      content: "# 旧史\n第一行\n关键事实在这里\n最后一行",
    }];

    expect(inspectSourceMaterials(materials, { query: "关键事实" }))
      .toHaveProperty("hits.0.documentId", "doc:one");
    expect(readSourceMaterial(materials, {
      documentId: "doc:one",
      startLine: 2,
      endLine: 3,
    })).toMatchObject({ content: "第一行\n关键事实在这里", startLine: 2, endLine: 3 });

    expect(() => parseSourceArtifact({
      bundleId: "bundle:user",
      baseRevision: 1,
      name: "改写旧史",
      documents: [{ path: "history.md", title: "旧史", content: "# 旧史\n改写" }],
    }, {
      sourceMaterials: materials,
      nextId: (prefix) => `${prefix}:1`,
    })).toThrow("用户上传的原始资料不可修改");
  });
});
