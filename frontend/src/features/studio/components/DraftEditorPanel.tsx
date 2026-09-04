import type { ReactNode } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import type { WorldDraft } from "@chatverse/world-authoring";
import type { EditorState } from "../draft/editorModel";

interface DraftEditorPanelProps {
  editor: EditorState;
  draft: WorldDraft;
  busy: boolean;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onSave: () => void;
}

export default function DraftEditorPanel({ editor, draft, busy, onClose, onPatch, onSave }: DraftEditorPanelProps) {
  const actorOptions = [
    ...draft.actors.map((actor) => ({ id: actor.id, name: actor.card.name })),
    ...(draft.player ? [{ id: draft.player.id, name: `玩家 · ${draft.player.profile.name}` }] : []),
  ];
  const title = editor.kind === "foundation" ? "世界核心"
    : editor.kind === "player" ? "玩家角色卡"
      : editor.kind === "actor" ? "角色卡"
        : editor.kind === "relation" ? "角色关系"
          : editor.kind === "context" ? "开场场景" : "剧情章节";

  return (
    <div className="studio-editor-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="studio-editor-panel" role="dialog" aria-modal="true" aria-label={`编辑${title}`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><p className="eyebrow">DIRECT EDIT</p><h2>{title}</h2><span>保存后生成新的草稿版本，可从顶部撤销。</span></div>
          <button className="icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X size={17} /></button>
        </header>
        <form className="studio-editor-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
          <div className="studio-editor-body">
            {editor.kind === "foundation" && <>
              <EditorField label="世界名称"><input value={editor.name} onChange={(event) => onPatch({ name: event.target.value })} autoFocus /></EditorField>
              <EditorField label="一句简介"><textarea value={editor.description} onChange={(event) => onPatch({ description: event.target.value })} rows={3} /></EditorField>
              <EditorField label="世界前提"><textarea value={editor.premise} onChange={(event) => onPatch({ premise: event.target.value })} rows={4} /></EditorField>
              <EditorField label="基调"><input value={editor.tone} onChange={(event) => onPatch({ tone: event.target.value })} placeholder="例如：克制、神话感、带一点幽默" /></EditorField>
              <EditorField label="核心背景"><textarea value={editor.loreCore} onChange={(event) => onPatch({ loreCore: event.target.value })} rows={5} /></EditorField>
              <EditorField hint="每行一条" label="世界规则"><textarea value={editor.rules} onChange={(event) => onPatch({ rules: event.target.value })} rows={4} /></EditorField>
            </>}
            {editor.kind === "player" && <>
              <EditorField label="参与方式"><select value={editor.mode} onChange={(event) => onPatch({ mode: event.target.value })}><option value="participant">亲自参与</option><option value="observer">旁观世界</option><option value="director">导演视角</option></select></EditorField>
              <div className="studio-editor-grid">
                <EditorField label="姓名"><input required value={editor.name} onChange={(event) => onPatch({ name: event.target.value })} autoFocus /></EditorField>
                <EditorField label="身份"><input required value={editor.identity} onChange={(event) => onPatch({ identity: event.target.value })} /></EditorField>
              </div>
              <EditorField label="公开背景"><textarea required value={editor.background} onChange={(event) => onPatch({ background: event.target.value })} rows={4} /></EditorField>
              <EditorField label="性格"><textarea required value={editor.personality} onChange={(event) => onPatch({ personality: event.target.value })} rows={3} /></EditorField>
              <EditorField label="外观"><textarea required value={editor.appearance} onChange={(event) => onPatch({ appearance: event.target.value })} rows={3} /></EditorField>
              <EditorField label="表达方式"><textarea required value={editor.speechStyle} onChange={(event) => onPatch({ speechStyle: event.target.value })} rows={3} /></EditorField>
              <EditorField hint="可填写“无”" label="参与边界"><textarea required value={editor.boundaries} onChange={(event) => onPatch({ boundaries: event.target.value })} rows={3} /></EditorField>
            </>}
            {editor.kind === "actor" && <>
              <div className="studio-editor-grid">
                <EditorField label="角色名称"><input value={editor.name} onChange={(event) => onPatch({ name: event.target.value })} autoFocus /></EditorField>
                <EditorField label="定位"><select value={editor.role} onChange={(event) => onPatch({ role: event.target.value })}><option value="lead">主要角色</option><option value="support">辅助角色</option></select></EditorField>
              </div>
              <EditorField label="身份与外在定位"><textarea value={editor.description} onChange={(event) => onPatch({ description: event.target.value })} rows={3} /></EditorField>
              <EditorField label="性格与说话方式"><textarea value={editor.personality} onChange={(event) => onPatch({ personality: event.target.value })} rows={5} /></EditorField>
              <EditorField label="角色自身背景"><textarea value={editor.background} onChange={(event) => onPatch({ background: event.target.value })} rows={5} /></EditorField>
              <EditorField label="默认处境与认知"><textarea value={editor.scenario} onChange={(event) => onPatch({ scenario: event.target.value })} rows={4} /></EditorField>
              <EditorField label="语言样例"><textarea value={editor.messageExample} onChange={(event) => onPatch({ messageExample: event.target.value })} rows={4} /></EditorField>
              <EditorField label="行为边界与补充"><textarea value={editor.instructions} onChange={(event) => onPatch({ instructions: event.target.value })} rows={4} /></EditorField>
            </>}
            {editor.kind === "relation" && <>
              <div className="studio-editor-grid">
                <EditorField label="关系起点"><select value={editor.fromActorId} onChange={(event) => onPatch({ fromActorId: event.target.value })}>{actorOptions.map((actor) => <option value={actor.id} key={actor.id}>{actor.name}</option>)}</select></EditorField>
                <EditorField label="关系终点"><select value={editor.toActorId} onChange={(event) => onPatch({ toActorId: event.target.value })}>{actorOptions.map((actor) => <option value={actor.id} key={actor.id}>{actor.name}</option>)}</select></EditorField>
              </div>
              <EditorField label="关系描述"><textarea value={editor.description} onChange={(event) => onPatch({ description: event.target.value })} rows={7} autoFocus /></EditorField>
            </>}
            {editor.kind === "context" && <>
              <EditorField label="演出方式"><select value={editor.presentationKind} onChange={(event) => onPatch({ presentationKind: event.target.value })}><option value="standard">标准世界</option><option value="galgame">Galgame 演出</option></select></EditorField>
              {editor.presentationKind === "galgame" && <EditorField label="美术方向"><textarea value={editor.artDirection} onChange={(event) => onPatch({ artDirection: event.target.value })} rows={3} /></EditorField>}
              <EditorField label="场景名称"><input value={editor.name} onChange={(event) => onPatch({ name: event.target.value })} autoFocus /></EditorField>
              <EditorField label="当前话题"><input value={editor.topic} onChange={(event) => onPatch({ topic: event.target.value })} /></EditorField>
              <EditorField label="现场氛围"><textarea value={editor.atmosphere} onChange={(event) => onPatch({ atmosphere: event.target.value })} rows={3} /></EditorField>
              <EditorField label="开场描述"><textarea value={editor.opening} onChange={(event) => onPatch({ opening: event.target.value })} rows={8} /></EditorField>
              <EditorField hint="每行一条" label="场景规则"><textarea value={editor.rules} onChange={(event) => onPatch({ rules: event.target.value })} rows={4} /></EditorField>
            </>}
            {editor.kind === "chapter" && <>
              <EditorField label="章节标题"><input value={editor.title} onChange={(event) => onPatch({ title: event.target.value })} autoFocus /></EditorField>
              <EditorField hint="约 600–1500 字，描述局面、冲突、力量与可推进空间" label="章节纲要"><textarea value={editor.treatment} onChange={(event) => onPatch({ treatment: event.target.value })} rows={10} /></EditorField>
              <EditorField label="阶段性结果"><textarea value={editor.targetOutcome} onChange={(event) => onPatch({ targetOutcome: event.target.value })} rows={4} /></EditorField>
            </>}
          </div>
          <footer className="studio-editor-actions">
            <button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>取消</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />}保存修改</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function EditorField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="studio-editor-field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}
