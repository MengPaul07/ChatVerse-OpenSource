import type { WorldArchive } from "@chatverse/core";
import { compileWorldSourceBundle } from "@chatverse/world-source";
import { createWorldDraft, listWorldDrafts, type WorldDraftRecord } from "./worldDraftLibrary";
import { providerRequestHeaders } from "./providerSettings";
import { saveWorldArchive, type WorldArchiveRecord } from "./worldArchiveLibrary";
import { instantiateWorldTemplate, type WorldTemplatePack } from "./worldTemplateCatalog";
import { loadBoundWorldSourceBundles, saveWorldSourceBundle } from "./worldSourceLibrary";

export interface StartedWorldTemplate {
  draft: WorldDraftRecord;
  archive: WorldArchiveRecord;
  roomId: string;
  path: string;
}

export async function createDraftFromWorldTemplate(template: WorldTemplatePack): Promise<WorldDraftRecord> {
  const source = compileWorldSourceBundle({
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
  await saveWorldSourceBundle(source, "architect");
  return createWorldDraft(instantiateWorldTemplate(template), undefined, template.id);
}

export async function countWorldsFromTemplate(template: WorldTemplatePack): Promise<number> {
  const records = await listWorldDrafts();
  return records.filter((record) => (
    record.sourceTemplateId === template.id || record.draft.id.startsWith(`world:${template.id}:`)
  )).length;
}

export async function startWorldFromTemplate(template: WorldTemplatePack): Promise<StartedWorldTemplate> {
  const draft = await createDraftFromWorldTemplate(template);
  const bundles = await loadBoundWorldSourceBundles(draft.draft.sources);
  const created = await worldRequest("/api/v1/worlds", {
    method: "POST",
    body: JSON.stringify({
      source: { kind: "world_draft", draft: draft.draft, bundles },
    }),
  });
  if (!created.roomId || !created.archive) throw new Error("无法创建世界实例。");

  const archiveWithCover: WorldArchive = {
    ...created.archive,
    metadata: {
      ...created.archive.metadata,
      coverImage: template.assets.cover.src,
    },
  };
  const archive = await saveWorldArchive(
    archiveWithCover,
    created.roomId,
    {
      kind: "world_draft",
      draftLibraryId: draft.libraryId,
      draftRevision: draft.draft.revision,
    },
  );

  return {
    draft,
    archive,
    roomId: created.roomId,
    path: `/worlds/${encodeURIComponent(draft.draft.id)}?archive=${encodeURIComponent(archive.libraryId)}&room=${encodeURIComponent(created.roomId)}`,
  };
}

interface WorldLaunchResponse {
  ok: boolean;
  message?: string;
  roomId?: string;
  archive?: WorldArchive;
}

async function worldRequest(path: string, init?: RequestInit): Promise<WorldLaunchResponse> {
  const response = await fetch(path, {
    ...init,
    headers: providerRequestHeaders({
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    }),
  });
  const body = await response.json().catch(() => ({
    ok: false,
    message: `服务返回了无法解析的响应（${response.status}）。`,
  })) as WorldLaunchResponse;
  if (!response.ok || body.ok === false) throw new Error(body.message || "世界操作失败。");
  return body;
}
