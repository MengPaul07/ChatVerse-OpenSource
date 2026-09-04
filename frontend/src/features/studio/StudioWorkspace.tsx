import {
  ArrowLeft,
  ChevronDown,
  CircleAlert,
  Clock3,
  GitBranch,
  LibraryBig,
  LoaderCircle,
  MessageSquareText,
  Network,
  Pencil,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type {
  DraftValidationResult,
  WorldDraft,
} from "@chatverse/world-authoring";
import { playerModeCopy, type EditorState } from "./draft/editorModel";
import ArchitectPanel, { type ArchitectPanelProps } from "./components/ArchitectPanel";
import { EmptyCopy, RelationGraphPreview, StudioSection } from "./components/StudioPrimitives";
import { StudioFoundation, StudioLore, StudioOutline } from "./components/StudioOverviewParts";
import WorldStudioSourcePanel from "../../pages/WorldStudioSourcePanel";

export interface StudioWorkspaceProps {
  draft: WorldDraft;
  validation?: DraftValidationResult;
  busy?: string;
  canEdit: boolean;
  error?: string;
  savedNotice?: string;
  architect: ArchitectPanelProps;
  onBack: () => void;
  onClearError: () => void;
  onOpenCharacterManager: () => void;
  onHistory: (action: "undo" | "redo") => void | Promise<void>;
  onPersist: () => void | Promise<void>;
  onPreview: () => void | Promise<void>;
  onCreateGroup: () => void | Promise<void>;
  onStartWorld: () => void | Promise<void>;
  onOpenEditor: (kind: EditorState["kind"], id?: string) => void;
  onOpenCharacterPicker: () => void;
  onOpenRelationGraph: () => void;
  onSourceBindingsChange: (
    sources: NonNullable<WorldDraft["sources"]>,
    summary: string,
  ) => Promise<void>;
  onSourceError: (message: string) => void;
  onSaveActor: (actor: WorldDraft["actors"][number]) => void | Promise<void>;
  onRemoveActor: (actorId: string) => void | Promise<void>;
}

export default function StudioWorkspace({
  draft,
  validation,
  busy,
  canEdit,
  error,
  savedNotice,
  architect,
  onBack,
  onClearError,
  onOpenCharacterManager,
  onHistory,
  onPersist,
  onPreview,
  onCreateGroup,
  onStartWorld,
  onOpenEditor,
  onOpenCharacterPicker,
  onOpenRelationGraph,
  onSourceBindingsChange,
  onSourceError,
  onSaveActor,
  onRemoveActor,
}: StudioWorkspaceProps) {
  return (
    <>
      <header className="studio-topbar">
        <button className="icon-button" onClick={onBack} title="返回" aria-label="返回">
          <ArrowLeft size={17} />
        </button>
        <div className="studio-title">
          <span>世界创作</span>
          <strong>{draft.metadata.name}</strong>
        </div>
        <div className="studio-status">
          <span className={validation?.valid ? "is-ready" : "is-draft"}>
            {validation?.valid ? "可运行" : "草稿未完成"}
          </span>
          {savedNotice && <small>{savedNotice}</small>}
        </div>
        <div className="studio-toolbar">
          <button className="button button-quiet studio-library-launcher" onClick={onOpenCharacterManager} title="打开角色素材库">
            <LibraryBig size={15} />角色库
          </button>
          <button className="icon-button" title="撤销" aria-label="撤销" disabled={!architect.session.canUndo || Boolean(busy)} onClick={() => void onHistory("undo")}>
            <Undo2 size={16} />
          </button>
          <button className="icon-button" title="重做" aria-label="重做" disabled={!architect.session.canRedo || Boolean(busy)} onClick={() => void onHistory("redo")}>
            <Redo2 size={16} />
          </button>
          <button className="button button-quiet" onClick={() => void onPersist()} disabled={Boolean(busy)}>
            <Save size={15} />保存
          </button>
          <button className="button button-quiet" onClick={() => void onPreview()} disabled={!validation?.valid || Boolean(busy)}>
            {busy === "preview" ? <LoaderCircle className="is-spinning" size={15} /> : <Play size={15} />}
            预演
          </button>
          {draft.runtimeProfile === "world_story" ? (
            <>
              <button className="button button-quiet" onClick={() => void onCreateGroup()} disabled={!validation?.valid || Boolean(busy)}>
                <MessageSquareText size={15} />开一个群聊
              </button>
              <button className="button button-primary" onClick={() => void onStartWorld()} disabled={!validation?.valid || Boolean(busy)}>
                <Sparkles size={15} />进入世界
              </button>
            </>
          ) : (
            <button className="button button-primary" onClick={() => void onCreateGroup()} disabled={!validation?.valid || Boolean(busy)}>
              <MessageSquareText size={15} />开一个群聊
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="studio-error" role="alert">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button className="icon-button" onClick={onClearError} title="关闭"><X size={14} /></button>
        </div>
      )}

      <div className="studio-layout">
        <StudioOutline draft={draft} validation={validation} />

        <main className="studio-canvas">
          <StudioFoundation draft={draft} canEdit={canEdit} onEdit={() => onOpenEditor("foundation")} />
          <StudioLore draft={draft} />
          <WorldStudioSourcePanel
            bindings={draft.sources ?? []}
            disabled={!canEdit}
            onError={onSourceError}
            onBindingsChange={onSourceBindingsChange}
          />

          <StudioSection
            icon={UserRound}
            eyebrow="PLAYER ACTOR"
            title="你在这个世界里是谁"
            meta={draft.player?.playerCard ? "角色卡已建立" : "等待建立"}
            action={(
              <button className="icon-button studio-edit-button" title="编辑玩家角色卡" aria-label="编辑玩家角色卡" disabled={!canEdit} onClick={() => onOpenEditor("player")}>
                <Pencil size={14} />
              </button>
            )}
          >
            {draft.player ? (
              <div className="studio-player-card">
                <span className="studio-player-avatar">{(draft.player.playerCard?.name || draft.player.profile.name || "你").slice(0, 1)}</span>
                <div className="studio-player-identity">
                  <strong>{draft.player.playerCard?.name || draft.player.profile.name || "你"}</strong>
                  <small>{draft.player.playerCard?.identity || "身份尚未建立"}</small>
                </div>
                <p>{draft.player.playerCard?.background || draft.player.profile.card || "还没有公开背景。完善角色卡后，世界中的人物才能正确理解你的身份。"}</p>
                <span className="studio-player-mode">{playerModeCopy(draft.player.mode)}</span>
              </div>
            ) : (
              <button className="studio-player-empty" type="button" disabled={!canEdit} onClick={() => onOpenEditor("player")}>
                <UserRound size={20} />
                <span><strong>建立玩家角色卡</strong><small>定义姓名、身份、背景与参与边界</small></span>
              </button>
            )}
          </StudioSection>

          <StudioSection
            icon={Users}
            eyebrow="CAST"
            title="登场角色"
            meta={`${draft.actors.length} 位角色`}
            action={(
              <div className="studio-section-actions">
                <button className="button button-quiet studio-library-command" title="打开角色库" disabled={!canEdit} onClick={onOpenCharacterManager}><LibraryBig size={14} /><span>角色库</span></button>
                <button className="icon-button studio-edit-button" title="从角色库带入" aria-label="从角色库带入" disabled={!canEdit} onClick={onOpenCharacterPicker}><UserPlus size={14} /></button>
                <button className="icon-button studio-edit-button" title="新建角色" aria-label="新建角色" disabled={!canEdit} onClick={() => onOpenEditor("actor")}><Plus size={14} /></button>
              </div>
            )}
          >
            <div className="studio-cast">
              {draft.actors.map((actor) => (
                <details className="studio-actor" key={actor.id}>
                  <summary>
                    <span className="studio-avatar">{actor.card.name.slice(0, 1)}</span>
                    <div><strong>{actor.card.name}</strong><small>{actor.role === "lead" ? "主要角色" : "辅助角色"}</small></div>
                    <p>{actor.card.description}</p>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="studio-actor-detail">
                    <p><strong>性格与语言</strong>{actor.card.personality}</p>
                    <p><strong>自身背景</strong>{actor.background || actor.card.scenario}</p>
                    <p><strong>语言样例</strong>{actor.card.messageExample || "尚未设置"}</p>
                    <button className="button button-quiet studio-edit-command" disabled={!canEdit} onClick={(event) => { event.preventDefault(); onOpenEditor("actor", actor.id); }}><Pencil size={13} />编辑角色</button>
                    <button className="button button-quiet studio-edit-command" disabled={!canEdit} onClick={(event) => { event.preventDefault(); void onSaveActor(actor); }}><Save size={13} />存入角色库</button>
                    <button className="button button-quiet studio-edit-command is-danger" disabled={!canEdit} onClick={(event) => { event.preventDefault(); void onRemoveActor(actor.id); }}><Trash2 size={13} />移出世界</button>
                  </div>
                </details>
              ))}
              {draft.actors.length === 0 && <EmptyCopy text="还没有角色。告诉创作助手谁应该生活在这里。" />}
            </div>
          </StudioSection>

          <div className="studio-split">
            <StudioSection
              icon={Network}
              eyebrow="RELATION GRAPH"
              title="关系"
              meta={`${draft.relations.length} 条`}
              action={<button className="icon-button studio-edit-button" title="打开关系图" aria-label="打开关系图" disabled={!canEdit} onClick={onOpenRelationGraph}><Network size={14} /></button>}
            >
              <RelationGraphPreview draft={draft} disabled={!canEdit} onOpen={onOpenRelationGraph} />
            </StudioSection>
            <StudioSection icon={GitBranch} eyebrow="CHAPTER PLAN" title="章节计划" meta={`${draft.chapters.length} 章`}>
              <div className="studio-chapter-list">
                {draft.chapters.map((chapter, index) => (
                  <div className="studio-chapter" key={chapter.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{chapter.title}</strong><p>{chapter.targetOutcome}</p></div>
                    <button className="icon-button studio-inline-edit" title="编辑剧情章节" aria-label="编辑剧情章节" disabled={!canEdit} onClick={() => onOpenEditor("chapter", chapter.id)}><Pencil size={13} /></button>
                  </div>
                ))}
                {draft.chapters.length === 0 && <EmptyCopy text="还没有剧情章节。" />}
              </div>
            </StudioSection>
          </div>

          <StudioSection
            icon={Clock3}
            eyebrow="OPENING SCENE"
            title={draft.contexts[0]?.name || "开场"}
            meta={draft.contexts[0]?.scene.topic || "待补充"}
            action={<button className="icon-button studio-edit-button" title="编辑开场" aria-label="编辑开场" disabled={!canEdit || !draft.contexts[0]} onClick={() => onOpenEditor("context", draft.contexts[0]?.id)}><Pencil size={14} /></button>}
          >
            <p className="studio-opening">{draft.contexts[0]?.opening || "开场尚未建立。"}</p>
          </StudioSection>
        </main>

        <ArchitectPanel {...architect} />
      </div>
    </>
  );
}
