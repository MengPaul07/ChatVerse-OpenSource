import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { PlayerCharacterCard } from "@chatverse/core";

const EMPTY_PLAYER_CARD: PlayerCharacterCard = {
  name: "",
  identity: "",
  background: "",
  personality: "",
  appearance: "",
  speechStyle: "",
  boundaries: "无",
};

export function GalgameDrawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="galgame-drawer" onClick={(event) => event.stopPropagation()}>
      <header>
        <strong>{title}</strong>
        <button onClick={onClose}><X size={18} /></button>
      </header>
      {children}
    </aside>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="galgame-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function PlayerCardDrawer({
  actorName,
  complete,
  initialCard,
  onSave,
  onClose,
}: {
  actorName: string;
  complete: boolean;
  initialCard?: PlayerCharacterCard;
  onSave: (card: PlayerCharacterCard) => Promise<void>;
  onClose: () => void;
}) {
  const [card, setCard] = useState(initialCard ? structuredClone(initialCard) : { ...EMPTY_PLAYER_CARD, name: actorName === "你" ? "" : actorName });
  const set = (key: keyof PlayerCharacterCard, value: string) => setCard((current) => ({ ...current, [key]: value }));
  return (
    <GalgameDrawer title={complete ? "编辑玩家角色卡" : "完成玩家角色卡"} onClose={onClose}>
      <form className="galgame-player-card" onSubmit={(event) => { event.preventDefault(); void onSave(card); }}>
        {([['name', '姓名'], ['identity', '身份'], ['background', '公开背景'], ['personality', '性格'], ['appearance', '外观'], ['speechStyle', '表达方式'], ['boundaries', '边界']] as Array<[keyof PlayerCharacterCard, string]>).map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            {key === "name"
              ? <input required value={String(card[key] ?? "")} onChange={(event) => set(key, event.target.value)} />
              : <textarea required rows={key === "background" ? 3 : 2} value={String(card[key] ?? "")} onChange={(event) => set(key, event.target.value)} />}
          </label>
        ))}
        <button className="button button-primary" type="submit">保存角色卡</button>
      </form>
    </GalgameDrawer>
  );
}
