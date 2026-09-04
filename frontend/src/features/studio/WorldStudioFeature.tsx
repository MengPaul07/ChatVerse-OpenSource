import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CircleAlert,
  WandSparkles,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  compileGroupCardFromWorldDraft,
  validateWorldDraft,
  type WorldDraft,
  type WorldDraftOperation,
} from "@chatverse/world-authoring";
import { createLibraryGroup } from "../../groupLibrary";
import {
  createWorldDraft,
  updateWorldDraft,
  type WorldDraftRecord,
} from "../../worldDraftLibrary";
import { saveWorldArchive } from "../../worldArchiveLibrary";
import { groupWorldManagePath } from "../../world/groupRoutes";
import {
  createLibraryCharacter,
  type LibraryCharacterRecord,
} from "../../characterLibrary";
import {
  loadBoundWorldSourceBundles,
  loadWorldSourceMaterials,
  materializeArchitectSourceArtifact,
} from "../../worldSourceLibrary";
import {
  authoringRequest,
  errorMessage,
} from "./api/client";
import type { PreviewResult } from "./api/contracts";
import {
  createEditorState,
  editorOperations,
  editorSummary,
  type EditorState,
} from "./draft/editorModel";
import StudioWorkspace from "./StudioWorkspace";
import StudioOverlays from "./StudioOverlays";
import { useAuthoringSession } from "./session/useAuthoringSession";

export default function WorldStudioFeature({
  defaultProfile = "world_story",
}: {
  defaultProfile?: "world_story" | "group_chat";
}) {
  const { draftId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string>();
  const [preview, setPreview] = useState<PreviewResult>();
  const [savedNotice, setSavedNotice] = useState<string>();
  const [planOpen, setPlanOpen] = useState(false);
  const [sessionLogOpen, setSessionLogOpen] = useState(false);
  const [showResearchSources, setShowResearchSources] = useState(false);
  const [editor, setEditor] = useState<EditorState>();
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  const [showCharacterManager, setShowCharacterManager] = useState(() => params.get("view") === "characters");
  const [showRelationGraph, setShowRelationGraph] = useState(false);
  const draftLibraryIdRef = useRef<string | undefined>(draftId);
  const draftPersistQueueRef = useRef<Promise<WorldDraftRecord | undefined>>(
    Promise.resolve(undefined),
  );
  const persistDraftRef = useRef<(nextDraft: WorldDraft) => Promise<WorldDraftRecord | undefined>>(
    async () => undefined,
  );
  const processingSourceArtifactRef = useRef<string | undefined>(undefined);
  const handleAcceptedDraft = useCallback(async (nextDraft: WorldDraft) => {
    await persistDraftRef.current(nextDraft);
  }, []);
  const {
    session,
    setSession,
    phase,
    error,
    setError,
    liveMarkdown,
    agentStatusText,
    sessionEvents,
    researchStatus,
    researchQuery,
    researchSourceCount,
    loadSessionLog,
    resetResearch,
  } = useAuthoringSession({
    defaultProfile,
    draftId,
    sourceGroupId: params.get("groupId") ?? undefined,
    onAcceptedDraft: handleAcceptedDraft,
  });

  const draft = session?.workingDraft;
  const acceptedDraft = session?.acceptedDraft;
  const validation = session?.validation ?? (draft ? validateWorldDraft(draft) : undefined);
  const researchSources = draft?.researchSources ?? [];
  const canEdit = Boolean(draft && !busy);

  function closeCharacterManager() {
    setShowCharacterManager(false);
    if (params.get("view") !== "characters") return;
    const nextParams = new URLSearchParams(params);
    nextParams.delete("view");
    navigate({ search: nextParams.toString() ? `?${nextParams.toString()}` : "" }, { replace: true });
  }

  async function toggleSessionLog() {
    if (!session) return;
    if (sessionLogOpen) {
      setSessionLogOpen(false);
      return;
    }
    setSessionLogOpen(true);
    try {
      await loadSessionLog();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function sendInstruction(event: FormEvent) {
    event.preventDefault();
    const message = instruction.trim();
    if (!message || !session) return;
    setInstruction("");
    await run("agent", async () => {
      const sourceMaterials = await loadWorldSourceMaterials(session.acceptedDraft.sources);
      const response = await authoringRequest(
        `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/messages`,
        { method: "POST", body: JSON.stringify({ message, sourceMaterials }) },
      );
      if (!response.session) throw new Error(response.message || "创作助手没有返回结果。");
      setSession(response.session);
    });
  }

  useEffect(() => {
    const artifact = session?.sourceArtifacts[0];
    if (!artifact || !acceptedDraft || processingSourceArtifactRef.current) return;
    processingSourceArtifactRef.current = artifact.id;
    void (async () => {
      try {
        const record = await materializeArchitectSourceArtifact(artifact);
        const nextBinding = {
          bundleId: record.bundle.id,
          revision: record.bundle.revision,
          fidelity: "reference" as const,
        };
        const sources = [
          ...(acceptedDraft.sources ?? []).filter((binding) => binding.bundleId !== record.bundle.id),
          nextBinding,
        ];
        const updated = await authoringRequest(
          `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/operations`,
          {
            method: "POST",
            body: JSON.stringify({
              baseRevision: acceptedDraft.revision,
              operations: [{ type: "set_sources", sources }],
              summary: `保存并绑定 Markdown 资料：${record.bundle.metadata.name}`,
            }),
          },
        );
        const consumed = await authoringRequest(
          `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/source-artifact-consume`,
          { method: "POST", body: JSON.stringify({ artifactId: artifact.id }) },
        );
        const nextSession = consumed.session ?? updated.session;
        if (nextSession) {
          setSession(nextSession);
          await persistDraftRef.current(nextSession.acceptedDraft);
        }
        setSavedNotice("创作助手已整理并绑定 Markdown 世界资料");
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        processingSourceArtifactRef.current = undefined;
      }
    })();
  }, [acceptedDraft?.revision, session?.id, session?.sourceArtifacts]);

  async function toggleResearch() {
    if (!session || !session.research.available) return;
    await run("research", async () => {
      const enabled = !session.research.enabled;
      const response = await authoringRequest(
        `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/research`,
        { method: "POST", body: JSON.stringify({ enabled }) },
      );
      if (!response.session) throw new Error(response.message || "无法切换联网创作。请稍后重试。");
      setSession(response.session);
      if (!enabled) resetResearch();
    });
  }

  function openEditor(kind: EditorState["kind"], id?: string) {
    if (!draft || busy) return;
    try {
      setEditor(createEditorState(draft, kind, id));
      setError(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function patchEditor(patch: Record<string, unknown>) {
    setEditor((current) => current ? { ...current, ...patch } as EditorState : current);
  }

  async function saveEditor() {
    if (!session || !acceptedDraft || !draft || !editor) return;
    await run("edit", async () => {
      await commitManualOperations(editorOperations(editor, draft), editorSummary(editor));
      setEditor(undefined);
    });
  }

  async function applyManualOperations(operations: WorldDraftOperation[], summary: string) {
    if (!session || !acceptedDraft || busy) return;
    await run("edit", () => commitManualOperations(operations, summary));
  }

  async function commitManualOperations(operations: WorldDraftOperation[], summary: string) {
    if (!session || !acceptedDraft) throw new Error("创作会话尚未准备好。");
    const response = await authoringRequest(
      `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/operations`,
      {
        method: "POST",
        body: JSON.stringify({
          baseRevision: acceptedDraft.revision,
          operations,
          summary,
        }),
      },
    );
    if (!response.session) throw new Error(response.message || "无法保存手动修改。");
    await persistDraft(response.session.acceptedDraft);
    setSession(response.session);
  }

  async function importActor(record: LibraryCharacterRecord) {
    if (!draft || !session || !acceptedDraft || busy) return false;
    const alias = `import:${record.libraryId}`;
    const context = draft.contexts[0];
    const operations: WorldDraftOperation[] = [{
      type: "upsert_actor",
      actor: {
        id: alias,
        role: "support",
        card: structuredClone(record.character),
        background: record.character.scenario,
      },
    }];
    if (context) {
      operations.push({
        type: "upsert_context",
        context: {
          ...context,
          actorIds: [...new Set([...context.actorIds, alias])],
        },
      });
    }
    setBusy("edit");
    try {
      await commitManualOperations(operations, `从角色库带入：${record.character.name}`);
      return true;
    } finally {
      setBusy(undefined);
    }
  }

  async function removeActor(actorId: string) {
    if (!draft) return;
    const actor = draft.actors.find((item) => item.id === actorId);
    if (!actor || !window.confirm(`确定将“${actor.card.name}”移出这份世界草稿吗？`)) return;
    const operations: WorldDraftOperation[] = [
      ...draft.relations
        .filter((relation) => relation.fromActorId === actorId || relation.toActorId === actorId)
        .map((relation): WorldDraftOperation => ({ type: "remove_relation", relationId: relation.id })),
      ...draft.contexts
        .filter((context) => context.actorIds.includes(actorId))
        .map((context): WorldDraftOperation => ({
          type: "upsert_context",
          context: { ...context, actorIds: context.actorIds.filter((id) => id !== actorId) },
        })),
      ...draft.chapters
        .filter((chapter) => chapter.actorIds.includes(actorId))
        .map((chapter): WorldDraftOperation => ({
          type: "upsert_chapter",
          chapter: { ...chapter, actorIds: chapter.actorIds.filter((id) => id !== actorId) },
        })),
      { type: "remove_actor", actorId },
    ];
    if (operations.length > 12) {
      setError("这个角色被过多关系或剧情章节引用，请先在关系图与章节中解除部分引用。");
      return;
    }
    await applyManualOperations(operations, `移除角色：${actor.card.name}`);
  }

  async function taskAction(action: "pause" | "resume") {
    if (!session) return;
    await run("task", async () => {
      const response = await authoringRequest(
        `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/task`,
        { method: "POST", body: JSON.stringify({ action }) },
      );
      if (!response.session) throw new Error(response.message || "无法更新长期创作任务。");
      setSession(response.session);
    });
  }

  async function historyAction(action: "undo" | "redo") {
    if (!session) return;
    await run(action, async () => {
      const response = await authoringRequest(
        `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/${action}`,
        { method: "POST" },
      );
      if (!response.session) throw new Error(response.message || "无法更新修改历史。");
      setSession(response.session);
      await persistDraft(response.session.acceptedDraft);
    });
  }

  async function persistDraft(nextDraft = acceptedDraft): Promise<WorldDraftRecord | undefined> {
    if (!nextDraft) return undefined;
    const task = draftPersistQueueRef.current.then(async () => {
      const currentLibraryId = draftLibraryIdRef.current;
      const record = currentLibraryId
        ? await updateWorldDraft(currentLibraryId, nextDraft)
        : await createWorldDraft(nextDraft, params.get("groupId") ?? undefined);
      if (!currentLibraryId) {
        draftLibraryIdRef.current = record.libraryId;
        window.history.replaceState(null, "", `/worlds/drafts/${record.libraryId}`);
      }
      setSavedNotice("已保存到本地世界库");
      window.setTimeout(() => setSavedNotice(undefined), 2200);
      return record;
    });
    draftPersistQueueRef.current = task.catch(() => undefined);
    return task;
  }

  persistDraftRef.current = persistDraft;

  async function runPreview() {
    if (!session) return;
    await run("preview", async () => {
      const bundles = await loadBoundWorldSourceBundles(session.workingDraft.sources);
      const response = await authoringRequest(
        `/api/v1/authoring/sessions/${encodeURIComponent(session.id)}/preview`,
        { method: "POST", body: JSON.stringify({ bundles }) },
      );
      if (!response.preview) throw new Error(response.message || "预演失败。");
      setPreview(response.preview);
      if (response.session) setSession(response.session);
    });
  }

  async function startWorld() {
    if (!acceptedDraft) return;
    await run("start", async () => {
      const savedDraft = await persistDraft(acceptedDraft);
      const bundles = await loadBoundWorldSourceBundles(acceptedDraft.sources);
      const response = await authoringRequest("/api/v1/worlds", {
        method: "POST",
        body: JSON.stringify({
          source: { kind: "world_draft", draft: acceptedDraft, bundles },
        }),
      });
      if (!response.roomId || !response.archive) {
        throw new Error(response.message || "无法创建世界实例。");
      }
      const archive = await saveWorldArchive(
        response.archive,
        response.roomId,
        savedDraft
          ? {
              kind: "world_draft",
              draftLibraryId: savedDraft.libraryId,
              draftRevision: acceptedDraft.revision,
            }
          : undefined,
      );
      navigate(
        `/worlds/${encodeURIComponent(acceptedDraft.id)}?archive=${encodeURIComponent(archive.libraryId)}&room=${encodeURIComponent(response.roomId)}`,
      );
    });
  }

  async function createGroup() {
    if (!acceptedDraft) return;
    await run("group", async () => {
      const group = compileGroupCardFromWorldDraft(acceptedDraft);
      const record = await createLibraryGroup(group, group.metadata.id);
      navigate(groupWorldManagePath(record.libraryId, record.group));
    });
  }

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  }

  if (phase === "loading") {
    return (
      <div className="studio-loading">
        <WandSparkles size={22} />
        <div><strong>正在打开 World Studio</strong><span>载入本地草稿与创作工具</span></div>
      </div>
    );
  }

  if (phase === "error" || !session || !draft) {
    return (
      <div className="studio-loading is-error">
        <CircleAlert size={22} />
        <div><strong>World Studio 无法启动</strong><span>{error}</span></div>
        <button className="button button-quiet studio-error-return" onClick={() => navigate(-1)}>返回</button>
      </div>
    );
  }

  return (
    <div className="world-studio page-enter">
      <StudioWorkspace
        draft={draft}
        validation={validation}
        busy={busy}
        canEdit={canEdit}
        error={error}
        savedNotice={savedNotice}
        onBack={() => navigate(-1)}
        onClearError={() => setError(undefined)}
        onOpenCharacterManager={() => setShowCharacterManager(true)}
        onHistory={(action) => void historyAction(action)}
        onPersist={() => void persistDraft()}
        onPreview={() => void runPreview()}
        onCreateGroup={() => void createGroup()}
        onStartWorld={() => void startWorld()}
        onOpenEditor={openEditor}
        onOpenCharacterPicker={() => setShowCharacterLibrary(true)}
        onOpenRelationGraph={() => setShowRelationGraph(true)}
        onSourceBindingsChange={(sources, summary) => applyManualOperations(
          [{ type: "set_sources", sources }],
          summary,
        )}
        onSourceError={(message) => setError(message)}
        onSaveActor={(actor) => void run("library", async () => {
          await createLibraryCharacter(actor.card);
          setSavedNotice(`${actor.card.name} 已作为独立副本存入角色库。`);
        })}
        onRemoveActor={(actorId) => void removeActor(actorId)}
        architect={{
          session,
          liveMarkdown,
          agentStatusText,
          sessionEvents,
          researchStatus,
          researchQuery,
          researchSourceCount,
          researchSources,
          busy,
          instruction,
          sessionLogOpen,
          planOpen,
          showResearchSources,
          onInstructionChange: setInstruction,
          onSubmit: sendInstruction,
          onToggleSessionLog: toggleSessionLog,
          onTogglePlan: () => setPlanOpen((open) => !open),
          onTaskAction: taskAction,
          onToggleResearch: toggleResearch,
          onToggleResearchSources: () => setShowResearchSources((current) => !current),
        }}
      />

      <StudioOverlays
        editor={editor}
        draft={draft}
        editorBusy={busy === "edit"}
        canEdit={canEdit}
        onCloseEditor={() => setEditor(undefined)}
        onPatchEditor={patchEditor}
        onSaveEditor={() => void saveEditor()}
        relationGraphOpen={showRelationGraph}
        onApplyRelations={applyManualOperations}
        onCloseRelationGraph={() => setShowRelationGraph(false)}
        characterPickerOpen={showCharacterLibrary}
        existingCharacterNames={draft.actors.map((actor) => actor.card.name)}
        onCloseCharacterPicker={() => setShowCharacterLibrary(false)}
        onSelectCharacter={importActor}
        characterManagerOpen={showCharacterManager}
        onCloseCharacterManager={closeCharacterManager}
        preview={preview}
        onClosePreview={() => setPreview(undefined)}
      />
    </div>
  );
}
