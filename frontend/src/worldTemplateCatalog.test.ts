import { describe, expect, it } from "vitest";
import { compileWorldDraft, validateWorldDraft } from "@chatverse/world-authoring";
import { compileWorldSourceBundle } from "@chatverse/world-source";
import { findWorldTemplate, instantiateWorldTemplate, WORLD_TEMPLATE_PACKS } from "./worldTemplateCatalog";

describe("world template catalog", () => {
  it("keeps the intended varied starter lineup", () => {
    expect(WORLD_TEMPLATE_PACKS.map((template) => template.id)).toEqual([
      "five-elements-mountain",
      "red-cliffs-council",
      "red-chamber-haitang",
      "mock-court",
      "archive-room",
      "sakura-hill-school-festival",
      "solvay-conference-1927",
    ]);
    expect(WORLD_TEMPLATE_PACKS.map((template) => template.id)).not.toContain("liaozhai-nie-xiaoqian");
    expect(WORLD_TEMPLATE_PACKS.map((template) => template.id)).not.toContain("abyss-observatory");
    expect(WORLD_TEMPLATE_PACKS.filter((template) => template.category === "anime")).toHaveLength(1);
    expect(WORLD_TEMPLATE_PACKS.filter((template) => template.category === "education")).toHaveLength(3);
  });

  it("builds valid independent world drafts with declared rights", () => {
    expect(WORLD_TEMPLATE_PACKS).toHaveLength(7);
    expect(WORLD_TEMPLATE_PACKS.filter((template) => template.sourceLabel === "公版名著改编")).toHaveLength(3);

    for (const template of WORLD_TEMPLATE_PACKS) {
      expect(template.source.documents.length, `${template.id}:source-documents`).toBeGreaterThanOrEqual(3);
      expect(template.source.documents.every((document) => document.path.endsWith(".md"))).toBe(true);
      const sourceBundle = compileWorldSourceBundle({
        id: template.source.bundleId,
        revision: 1,
        name: template.source.name,
        description: template.source.description,
        documents: template.source.documents.map((document) => ({
          path: document.path,
          title: document.title,
          format: "markdown" as const,
          content: document.content,
        })),
      });
      expect(sourceBundle.documents).toHaveLength(template.source.documents.length);
      expect(sourceBundle.chunks.length, `${template.id}:source-chunks`).toBeGreaterThan(0);
      expect(template.assets.cover.src).toMatch(/^\/(world-covers|world-assets)\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\.(jpg|webp|png)$/);
      expect(["image/jpeg", "image/webp", "image/png"]).toContain(template.assets.cover.mimeType);
      expect(template.assets.cover).toMatchObject({
        kind: "bundled",
        width: 1536,
        height: 864,
      });
      expect(template.assets.cover.alt.length).toBeGreaterThan(8);
      const first = instantiateWorldTemplate(template);
      const second = instantiateWorldTemplate(template);

      expect(validateWorldDraft(first).valid).toBe(true);
      expect(first.sources).toEqual([
        { bundleId: template.source.bundleId, revision: 1, fidelity: "reference" },
      ]);
      expect(first.metadata.rights?.basis).toBeTruthy();
      expect(first.actors.length).toBeGreaterThan(0);
      expect(first.contexts[0]?.actorIds).toContain(first.actors[0]?.id);
      expect(first.contexts[0]?.presentation).toMatchObject({
        kind: "galgame",
        playerActorId: first.player?.id,
        acknowledgement: "required",
      });
      expect(first.player?.playerCard).toBeTruthy();
      const playerCard = first.player?.playerCard;
      expect(first.player?.profile.name).not.toBe("你");
      expect(playerCard?.name).toBe(first.player?.profile.name);
      for (const field of ["identity", "background", "personality", "appearance", "speechStyle", "boundaries"] as const) {
        expect(playerCard?.[field].trim().length, `${template.id}:${field}`).toBeGreaterThan(8);
      }
      expect(first.player?.profile.card).not.toContain("刚刚进入这个世界的人");
      expect(first.contexts[0]?.opening).toContain("你");
      expect(compileWorldDraft(first).contexts[0]?.runtime?.beatRuntime).toEqual({
        presentationPrefetchLimit: 5,
      });
      expect(first.id).not.toBe(second.id);
      expect(first.id).toMatch(new RegExp(`^world:${template.id}:`));
      expect(findWorldTemplate({ worldId: first.id })?.id).toBe(template.id);
      expect(findWorldTemplate({ name: first.metadata.name })?.id).toBe(template.id);
    }
  });

  it("gives every bundled world an opening Chapter with valid references", () => {
    expect(WORLD_TEMPLATE_PACKS).toHaveLength(7);

    for (const template of WORLD_TEMPLATE_PACKS) {
      const draft = template.createDraft(`test:${template.id}`);

      expect(draft.contexts).toHaveLength(1);
      expect(draft.chapters.length, template.id).toBeGreaterThanOrEqual(2);
      expect(draft.chapters.length, template.id).toBeLessThanOrEqual(4);
      expect(draft.chapters.filter((chapter) => chapter.status === "active"), `${template.id}:active`).toHaveLength(1);
      const queuedChapters = draft.chapters.filter((chapter) => chapter.status === "queued");
      expect(queuedChapters.length, `${template.id}:queued`).toBeGreaterThanOrEqual(1);
      expect(queuedChapters.length, `${template.id}:queued`).toBeLessThanOrEqual(3);
      expect(new Set(draft.chapters.map((chapter) => chapter.title)).size).toBe(draft.chapters.length);
      for (const chapter of draft.chapters) {
        expect(chapter.treatment.length, `${template.id}:${chapter.title}:treatment`).toBeGreaterThanOrEqual(600);
        expect(chapter.treatment.length, `${template.id}:${chapter.title}:treatment`).toBeLessThanOrEqual(1500);
        expect(chapter.title).not.toContain("后续推进");
        expect(chapter.contextIds.every((id) => draft.contexts.some((context) => context.id === id))).toBe(true);
        expect(chapter.actorIds.every((id) => draft.actors.some((actor) => actor.id === id))).toBe(true);
      }
    }
  });

  it("keeps bundled stage assets mapped to every template actor", () => {
    for (const template of WORLD_TEMPLATE_PACKS) {
      const stage = template.assets.stage;
      if (!stage) continue;

      const draft = template.createDraft(`stage-assets:${template.id}`);
      for (const actor of draft.actors) {
        expect(stage.portraits[actor.card.name], `${template.id}:${actor.card.name}`).toBeDefined();
      }
      expect(stage.background.src).toMatch(/^\/world-assets\//);
      expect(stage.background.mimeType).toMatch(/^image\//);
    }
  });
});
