import {
  BookOpenText,
  Check,
  GitBranch,
  Network,
  Pencil,
  Users,
} from "lucide-react";
import {
  type DraftValidationResult,
  type WorldDraft,
} from "@chatverse/world-authoring";
import { studioValidationMessage } from "../api/client";
import { OutlineItem, StudioSection } from "./StudioPrimitives";

export function StudioOutline({
  draft,
  validation,
}: {
  draft: WorldDraft;
  validation?: DraftValidationResult;
}) {
  return (
    <aside className="studio-outline">
      <div className="studio-outline-heading">
        <span>作品结构</span>
        <small>第 {draft.revision + 1} 稿</small>
      </div>
      <OutlineItem icon={BookOpenText} label="世界核心" value={draft.premise ? "已建立" : "待补充"} />
      <OutlineItem icon={Users} label="角色" value={`${draft.actors.length} 位`} />
      <OutlineItem icon={Network} label="关系" value={`${draft.relations.length} 条`} />
      <OutlineItem icon={GitBranch} label="剧情章节" value={`${draft.chapters.length} 条`} />
      <section className="studio-validation">
        <strong>运行检查</strong>
        {(validation?.issues ?? []).slice(0, 6).map((issue) => (
          <div className={`validation-row is-${issue.severity}`} key={`${issue.code}-${issue.path}`}>
            <span />
            <p>{studioValidationMessage(issue.message)}</p>
          </div>
        ))}
        {validation?.issues.length === 0 && (
          <div className="validation-row is-ready"><Check size={13} /><p>结构和引用均有效</p></div>
        )}
      </section>
    </aside>
  );
}

export function StudioFoundation({
  draft,
  canEdit,
  onEdit,
}: {
  draft: WorldDraft;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <section className="studio-foundation">
      <div>
        <p className="eyebrow">{draft.runtimeProfile === "world_story" ? "叙事世界" : "群聊世界"}</p>
        <h1>{draft.metadata.name}</h1>
        <p>{draft.metadata.description || "还没有世界简介。"}</p>
      </div>
      <div className="studio-foundation-side">
        <blockquote>{draft.premise || "告诉创作助手：这个世界从哪里开始？"}</blockquote>
        <button className="button button-quiet studio-edit-command" disabled={!canEdit} onClick={onEdit}>
          <Pencil size={14} />编辑世界核心
        </button>
      </div>
    </section>
  );
}

export function StudioLore({ draft }: { draft: WorldDraft }) {
  return (
    <StudioSection
      icon={BookOpenText}
      eyebrow="WORLD CORE"
      title="这个世界相信什么"
      meta={`${draft.lore.rules.length} 条规则`}
    >
      <p className="studio-lore">{draft.lore.core || "核心背景尚未建立。"}</p>
      {draft.lore.rules.length > 0 && (
        <ul className="studio-rule-list">
          {draft.lore.rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      )}
    </StudioSection>
  );
}
