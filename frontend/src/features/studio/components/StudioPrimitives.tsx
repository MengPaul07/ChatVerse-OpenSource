import { useMemo, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorldDraft } from "@chatverse/world-authoring";
import MarkdownContent from "../../../components/MarkdownContent";

export function OutlineItem({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <div className="studio-outline-item"><Icon size={15} /><span>{label}</span><small>{value}</small></div>;
}

export function StudioSection({ icon: Icon, eyebrow, title, meta, action, children }: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  meta: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="studio-section">
      <header className="studio-section-heading">
        <span className="studio-section-icon"><Icon size={16} /></span>
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        <span className="studio-section-meta">{meta}</span>
        {action}
      </header>
      {children}
    </section>
  );
}

export function RelationGraphPreview({ draft, disabled, onOpen }: {
  draft: WorldDraft;
  disabled: boolean;
  onOpen: () => void;
}) {
  const people = useMemo(() => [
    ...draft.actors.map((actor) => ({ id: actor.id, name: actor.card.name })),
    ...(draft.player ? [{ id: draft.player.id, name: draft.player.profile.name }] : []),
  ], [draft.actors, draft.player]);
  const positions = useMemo(() => {
    const columns = people.length <= 1 ? 1 : people.length <= 4 ? 2 : 3;
    const rows = Math.max(1, Math.ceil(people.length / columns));
    return new Map(people.map((person, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return [person.id, {
        x: columns === 1 ? 50 : 16 + (column * 68) / (columns - 1),
        y: rows === 1 ? 50 : 18 + (row * 64) / (rows - 1),
      }] as const;
    }));
  }, [people]);
  const knownIds = useMemo(() => new Set(people.map((person) => person.id)), [people]);
  const relations = draft.relations.filter((relation) => (
    knownIds.has(relation.fromActorId) && knownIds.has(relation.toActorId)
  ));

  return (
    <button className="studio-relation-preview" type="button" disabled={disabled} onClick={onOpen} aria-label="打开完整关系图">
      <span className="studio-relation-map" aria-hidden="true">
        {people.length > 0 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <marker id="studio-relation-preview-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#86a69b" />
              </marker>
            </defs>
            {relations.map((relation) => {
              const from = positions.get(relation.fromActorId);
              const to = positions.get(relation.toActorId);
              if (!from || !to) return null;
              return <line key={relation.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#studio-relation-preview-arrow)" />;
            })}
          </svg>
        )}
        {people.map((person) => {
          const position = positions.get(person.id);
          if (!position) return null;
          return (
            <span className="studio-relation-mini-node" key={person.id} style={{ left: `${position.x}%`, top: `${position.y}%` }}>
              <i>{person.name.slice(0, 1) || "?"}</i>
              <b>{person.name.length > 5 ? `${person.name.slice(0, 5)}…` : person.name}</b>
            </span>
          );
        })}
        {people.length === 0 && <span className="studio-relation-map-empty">添加角色后，关系会显示在这里</span>}
      </span>
      <span className="studio-relation-preview-footer">
        <span><strong>{people.length} 位参与者</strong><em>{draft.relations.length} 条定向关系</em></span>
        <span>打开完整关系图 <ArrowUpRight size={14} /></span>
      </span>
    </button>
  );
}

export function EmptyCopy({ text }: { text: string }) {
  return <p className="studio-empty-copy">{text}</p>;
}

export function Markdown({ content }: { content: string }) {
  return <MarkdownContent content={content} />;
}
