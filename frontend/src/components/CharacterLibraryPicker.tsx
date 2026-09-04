import {
  Search,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  listLibraryCharacters,
  type LibraryCharacterRecord,
} from "../characterLibrary";

interface CharacterLibraryPickerProps {
  open: boolean;
  title?: string;
  description?: string;
  existingNames?: Iterable<string>;
  onClose: () => void;
  onSelect: (record: LibraryCharacterRecord) => void | boolean | Promise<void | boolean>;
}

export default function CharacterLibraryPicker({
  open,
  title = "从角色库带入",
  description = "角色会作为独立副本进入这里，不会改动角色库原卡。",
  existingNames = [],
  onClose,
  onSelect,
}: CharacterLibraryPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [records, setRecords] = useState<LibraryCharacterRecord[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const occupiedNames = useMemo(
    () => new Set([...existingNames].map((name) => name.trim())),
    [existingNames],
  );
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return records;
    return records.filter((record) => (
      record.character.name.toLocaleLowerCase("zh-CN").includes(keyword) ||
      record.character.description.toLocaleLowerCase("zh-CN").includes(keyword) ||
      record.character.personality.toLocaleLowerCase("zh-CN").includes(keyword)
    ));
  }, [query, records]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError(undefined);
    void listLibraryCharacters()
      .then(setRecords)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "角色库暂时无法读取。");
      })
      .finally(() => setIsLoading(false));
  }, [open]);

  async function select(record: LibraryCharacterRecord) {
    if (occupiedNames.has(record.character.name) || selectedId) return;
    setSelectedId(record.libraryId);
    setError(undefined);
    try {
      const accepted = await onSelect(record);
      if (accepted !== false) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "角色暂时无法加入。");
    } finally {
      setSelectedId(undefined);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="character-picker"
      aria-labelledby="character-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="character-picker-header">
        <div>
          <p className="eyebrow">CHARACTER LIBRARY</p>
          <h2 id="character-picker-title">{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          title="关闭"
          aria-label="关闭角色库"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>

      <label className="character-picker-search">
        <Search size={16} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名字、身份或性格"
        />
      </label>

      {error && <p className="character-picker-error" role="alert">{error}</p>}

      <div className="character-picker-list">
        {isLoading ? (
          <p className="character-picker-empty">正在读取本地角色库…</p>
        ) : filtered.length > 0 ? (
          filtered.map((record) => {
            const exists = occupiedNames.has(record.character.name);
            const isAdding = selectedId === record.libraryId;
            return (
              <button
                key={record.libraryId}
                type="button"
                disabled={exists || Boolean(selectedId)}
                onClick={() => void select(record)}
              >
                <Avatar name={record.character.name} />
                <span>
                  <strong>{record.character.name}</strong>
                  <small>{record.character.description || record.character.personality || "还没有角色摘要"}</small>
                </span>
                <em>{exists ? "已在这里" : isAdding ? "正在带入" : "带入"}</em>
              </button>
            );
          })
        ) : (
          <div className="character-picker-empty">
            <UsersRound size={22} />
            <strong>{records.length === 0 ? "角色库还是空的" : "没有匹配的角色"}</strong>
            <span>{records.length === 0 ? "先创建一张可复用角色卡，再把它带进世界。" : "换一个名字或身份关键词试试。"}</span>
          </div>
        )}
      </div>

      <footer className="character-picker-footer">
        <span><UserPlus size={14} />带入后拥有独立的世界状态与记忆</span>
        <Link to="/worlds/new?view=characters" onClick={onClose}>管理角色库</Link>
      </footer>
    </dialog>
  );
}

function Avatar({ name }: { name: string }) {
  return <span className="group-avatar" aria-hidden="true">{(name || "?").slice(0, 1)}</span>;
}
