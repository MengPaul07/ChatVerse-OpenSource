import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { decodeGroupPackageArchive } from "@chatverse/group-package";
import {
  deleteLibraryGroup,
  exportGroupPackage,
  installDecodedPackage,
  listLibraryGroups,
  type LibraryGroupRecord,
} from "../groupLibrary";
import { ChatVerseContext } from "./ChatVerseContext";
import type { GroupSummary, ChatVerseState } from "./state-types";

export function ChatVerseProvider({ children }: PropsWithChildren) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [isLibraryReady, setIsLibraryReady] = useState(false);

  const refreshGroups = useCallback(async () => {
    const records = await listLibraryGroups();
    setGroups(records.map(toGroupSummary));
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await refreshGroups();
      if (mounted) setIsLibraryReady(true);
    })().catch((error) => {
      console.error("Unable to load group library", error);
      if (mounted) setIsLibraryReady(true);
    });
    return () => { mounted = false; };
  }, [refreshGroups]);

  const deleteGroup = useCallback(async (groupId: string) => {
    await deleteLibraryGroup(groupId);
    await refreshGroups();
  }, [refreshGroups]);

  const importGroup = useCallback(async (file: File) => {
    const decoded = decodeGroupPackageArchive(new Uint8Array(await file.arrayBuffer()));
    const record = await installDecodedPackage(decoded);
    await refreshGroups();
    return record;
  }, [refreshGroups]);

  const exportGroup = useCallback(async (groupId: string) => {
    const { archive, fileName } = await exportGroupPackage(groupId);
    const url = URL.createObjectURL(new Blob([archive.slice().buffer], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const value = useMemo<ChatVerseState>(() => ({
    isLibraryReady,
    groups,
    deleteGroup,
    importGroup,
    exportGroup,
  }), [
    deleteGroup, exportGroup, groups, importGroup, isLibraryReady,
  ]);

  return <ChatVerseContext.Provider value={value}>{children}</ChatVerseContext.Provider>;
}

function toGroupSummary(record: LibraryGroupRecord): GroupSummary {
  const human = record.group.userProfiles?.[0];
  return {
    id: record.libraryId,
    name: record.group.metadata.name,
    topic: record.group.scene.topic,
    memberCount: record.group.characters.length + (record.group.userProfiles?.length ?? 0),
    humanName: human?.name ?? "你",
    group: record.group,
    updatedAt: record.updatedAt,
  };
}
