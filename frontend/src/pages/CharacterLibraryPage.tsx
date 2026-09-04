import { useEffect, useRef, useState } from "react";
import { Download, FilePlus2, Import, Plus, Save, Trash2, UsersRound, X } from "lucide-react";
import type { CharacterCard } from "@chatverse/core";
import {
  createEmptyCharacter,
  createLibraryCharacter,
  decodeCharacterPackage,
  deleteLibraryCharacter,
  exportCharacterPackage,
  listLibraryCharacters,
  updateLibraryCharacter,
  type LibraryCharacterRecord,
} from "../characterLibrary";

export default function CharacterLibraryPage({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose?: () => void;
} = {}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<LibraryCharacterRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CharacterCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = records.find((record) => record.libraryId === selectedId) ?? null;

  async function refresh(nextSelectedId = selectedId) {
    const next = await listLibraryCharacters();
    setRecords(next);
    if (nextSelectedId && next.some((record) => record.libraryId === nextSelectedId)) {
      setSelectedId(nextSelectedId);
      const record = next.find((item) => item.libraryId === nextSelectedId)!;
      setDraft(structuredClone(record.character));
      return;
    }
    const fallback = next[0] ?? null;
    setSelectedId(fallback?.libraryId ?? null);
    setDraft(fallback ? structuredClone(fallback.character) : null);
  }

  useEffect(() => {
    void refresh().catch((error) => setNotice(error instanceof Error ? error.message : "角色库无法读取。 ")).finally(() => setIsLoading(false));
  }, []);

  function selectRecord(record: LibraryCharacterRecord) {
    setSelectedId(record.libraryId);
    setDraft(structuredClone(record.character));
    setNotice(null);
  }

  async function createCharacter() {
    try {
      const record = await createLibraryCharacter(createEmptyCharacter());
      await refresh(record.libraryId);
      setNotice("已创建一张新角色卡。 ");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "角色卡创建失败。请检查浏览器存储权限或剩余空间。");
    }
  }

  async function saveCharacter() {
    if (!selected || !draft) return;
    setIsSaving(true);
    try {
      await updateLibraryCharacter(selected.libraryId, draft);
      await refresh(selected.libraryId);
      setNotice("角色卡已保存到本地角色库。 ");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "角色卡保存失败。请检查浏览器存储权限或剩余空间。");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeCharacter() {
    if (!selected) return;
    await deleteLibraryCharacter(selected.libraryId);
    await refresh(null);
    setNotice("角色卡已从本地角色库移除；已加入的群不会受影响。 ");
  }

  async function importCharacter(file: File | undefined) {
    if (!file) return;
    try {
      const character = decodeCharacterPackage(await file.text());
      const record = await createLibraryCharacter(character);
      await refresh(record.libraryId);
      setNotice(`已导入 ${record.character.name}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "角色卡无法导入。 ");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function exportCharacter() {
    if (!draft) return;
    const { contents, fileName } = exportCharacterPackage(draft);
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`character-library-page page-enter${embedded ? " is-embedded" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{embedded ? "STUDIO · CHARACTER LIBRARY" : "可复用角色"}</p>
          <h1>{embedded ? "角色素材库" : "角色库"}</h1>
          <p>{embedded ? "把可复用的人格放在这里，再带入不同世界；每次带入都会拥有独立的处境与记忆。" : "角色卡是可带入任何群的独立人格。导入群后会形成副本，群内关系和即时处境只属于那一个群。"}</p>
        </div>
        <div className="header-actions">
          <input ref={importInputRef} type="file" accept=".chatverse-character.json,application/json" hidden onChange={(event) => void importCharacter(event.target.files?.[0])} />
          {embedded ? (
            <span className="character-library-context-label">新角色请在 Studio 中创建</span>
          ) : (
            <>
              <button className="button button-quiet" onClick={() => importInputRef.current?.click()}><Import size={16} />导入角色卡</button>
              <button className="button button-primary" onClick={() => void createCharacter()}><Plus size={16} />新建角色</button>
            </>
          )}
          {embedded && onClose && <button type="button" className="icon-button character-library-close" title="返回世界创作" aria-label="返回世界创作" onClick={onClose}><X size={17} /></button>}
        </div>
      </header>

      {notice && <p className="character-library-notice" role="status">{notice}</p>}

      {isLoading ? <div className="page-loading">正在读取本地角色库…</div> : (
        <section className="character-library-workbench">
          <aside className="character-library-list" aria-label="角色卡列表">
            <div className="character-library-list-head"><span>角色卡</span><strong>{records.length}</strong></div>
            {records.length === 0 ? <p className="character-library-list-empty">暂无角色。请先在 Studio 创建。</p> : records.map((record) => (
              <button key={record.libraryId} type="button" className={`character-library-row${record.libraryId === selectedId ? " is-active" : ""}`} onClick={() => selectRecord(record)}>
                <Avatar name={record.character.name} />
                <span><strong>{record.character.name}</strong><small>{record.character.description || record.character.personality || "还没有角色摘要"}</small></span>
              </button>
            ))}
          </aside>

          <main className="character-library-editor">
            {!draft ? <EmptyCharacterLibrary embedded={embedded} onCreate={() => void createCharacter()} onClose={onClose} /> : (
              <>
                <header className="character-editor-header">
                  <div className="character-editor-title"><Avatar name={draft.name} /><div><p className="eyebrow">角色本体</p><h2>{draft.name || "未命名角色"}</h2></div></div>
                  <div className="header-actions">
                    <button type="button" className="icon-button" title="导出角色卡" aria-label="导出角色卡" onClick={exportCharacter}><Download size={17} /></button>
                    <button type="button" className="icon-button" title="删除角色卡" aria-label="删除角色卡" onClick={() => void removeCharacter()}><Trash2 size={17} /></button>
                    <button type="button" className="button button-primary" disabled={isSaving} onClick={() => void saveCharacter()}><Save size={16} />{isSaving ? "保存中" : "保存"}</button>
                  </div>
                </header>
                <div className="character-editor-fields">
                  <CharacterField label="名称" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
                  <CharacterArea label="身份描述" rows={3} value={draft.description} onChange={(value) => setDraft({ ...draft, description: value })} />
                  <CharacterArea label="性格与口吻" rows={5} value={draft.personality} onChange={(value) => setDraft({ ...draft, personality: value })} />
                  <CharacterArea label="自身背景与既有认知" rows={5} value={draft.scenario} onChange={(value) => setDraft({ ...draft, scenario: value })} />
                  <CharacterArea label="对话样例" rows={5} value={draft.messageExample} onChange={(value) => setDraft({ ...draft, messageExample: value })} />
                  <CharacterArea label="行为边界与补充" rows={4} value={draft.instructions ?? ""} onChange={(value) => setDraft({ ...draft, instructions: value })} />
                  <div className="character-editor-boundary"><FilePlus2 size={17} /><p><strong>群内内容不在这里同步</strong><span>角色加入群后，群内处境、关系图与那次群聊的场景由群独立维护。</span></p></div>
                </div>
              </>
            )}
          </main>
        </section>
      )}
    </div>
  );
}

function EmptyCharacterLibrary({
  embedded,
  onCreate,
  onClose,
}: {
  embedded: boolean;
  onCreate: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="empty-state character-empty">
      <UsersRound size={24} />
      <h3>这里还没有角色卡</h3>
      <p>{embedded ? "在 Studio 的登场角色区创建角色后，它会出现在这里供你查看和复用。" : "先写下一个可复用人格，之后在任何新群中一键带入。"}</p>
      {embedded && onClose ? (
        <button type="button" className="button button-primary" onClick={onClose}><Plus size={16} />返回 Studio 创建</button>
      ) : (
        <button type="button" className="button button-primary" onClick={onCreate}><Plus size={16} />新建角色</button>
      )}
    </div>
  );
}

function CharacterField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CharacterArea({ label, rows, value, onChange }: { label: string; rows: number; value: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Avatar({ name }: { name: string }) {
  return <span className="group-avatar" aria-hidden="true">{(name || "?").slice(0, 1)}</span>;
}
