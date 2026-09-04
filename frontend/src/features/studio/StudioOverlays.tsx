import { X } from "lucide-react";
import type {
  WorldDraft,
  WorldDraftOperation,
} from "@chatverse/world-authoring";
import CharacterLibraryPicker from "../../components/CharacterLibraryPicker";
import CharacterLibraryPage from "../../pages/CharacterLibraryPage";
import WorldDraftRelationGraph from "../../components/WorldDraftRelationGraph";
import MarkdownContent from "../../components/MarkdownContent";
import type { LibraryCharacterRecord } from "../../characterLibrary";
import type { PreviewResult } from "./api/contracts";
import DraftEditorPanel from "./components/DraftEditorPanel";
import { EmptyCopy } from "./components/StudioPrimitives";
import type { EditorState } from "./draft/editorModel";

export interface StudioOverlaysProps {
  editor?: EditorState;
  draft: WorldDraft;
  editorBusy: boolean;
  canEdit: boolean;
  onCloseEditor: () => void;
  onPatchEditor: (patch: Record<string, unknown>) => void;
  onSaveEditor: () => void;
  relationGraphOpen: boolean;
  onApplyRelations: (operations: WorldDraftOperation[], summary: string) => Promise<void>;
  onCloseRelationGraph: () => void;
  characterPickerOpen: boolean;
  existingCharacterNames: string[];
  onCloseCharacterPicker: () => void;
  onSelectCharacter: (record: LibraryCharacterRecord) => Promise<boolean>;
  characterManagerOpen: boolean;
  onCloseCharacterManager: () => void;
  preview?: PreviewResult;
  onClosePreview: () => void;
}

export default function StudioOverlays({
  editor,
  draft,
  editorBusy,
  canEdit,
  onCloseEditor,
  onPatchEditor,
  onSaveEditor,
  relationGraphOpen,
  onApplyRelations,
  onCloseRelationGraph,
  characterPickerOpen,
  existingCharacterNames,
  onCloseCharacterPicker,
  onSelectCharacter,
  characterManagerOpen,
  onCloseCharacterManager,
  preview,
  onClosePreview,
}: StudioOverlaysProps) {
  return (
    <>
      {editor && (
        <DraftEditorPanel
          editor={editor}
          draft={draft}
          busy={editorBusy}
          onClose={onCloseEditor}
          onPatch={onPatchEditor}
          onSave={onSaveEditor}
        />
      )}

      {relationGraphOpen && (
        <WorldDraftRelationGraph
          draft={draft}
          disabled={!canEdit}
          onApply={onApplyRelations}
          onClose={onCloseRelationGraph}
        />
      )}

      <CharacterLibraryPicker
        open={characterPickerOpen}
        existingNames={existingCharacterNames}
        onClose={onCloseCharacterPicker}
        onSelect={onSelectCharacter}
      />

      {characterManagerOpen && (
        <div className="studio-library-backdrop" role="presentation" onMouseDown={onCloseCharacterManager}>
          <section className="studio-library-panel" role="dialog" aria-modal="true" aria-label="角色素材库" onMouseDown={(event) => event.stopPropagation()}>
            <CharacterLibraryPage embedded onClose={onCloseCharacterManager} />
          </section>
        </div>
      )}

      {preview && (
        <div className="studio-preview-backdrop" role="presentation" onMouseDown={onClosePreview}>
          <section className="studio-preview" role="dialog" aria-modal="true" aria-label="世界短预演" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">REHEARSAL</p><h2>世界短预演</h2><span>{preview.beatCount} 个剧情节点 · 不写入正式历史</span></div>
              <button className="icon-button" onClick={onClosePreview} title="关闭"><X size={17} /></button>
            </header>
            <div className="preview-stream">
              {preview.entries.map((entry) => (
                <div className={`preview-entry is-${entry.kind}`} key={entry.id}>
                  <span>{entry.kind === "narration" ? "旁白" : entry.actorName || "动作"}</span>
                  <MarkdownContent content={entry.kind === "action" ? `（${entry.actorName ? `${entry.actorName}${entry.text}` : entry.text}）` : entry.text} />
                </div>
              ))}
              {preview.entries.length === 0 && <EmptyCopy text="这次预演没有产生可见内容。" />}
            </div>
            {preview.warnings.map((warning) => <p className="preview-warning" key={warning}>{warning}</p>)}
          </section>
        </div>
      )}
    </>
  );
}
