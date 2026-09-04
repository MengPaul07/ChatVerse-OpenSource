import type { GroupCard } from "@chatverse/core";
import type { LibraryGroupRecord } from "../groupLibrary";

export interface GroupSummary {
  id: string;
  name: string;
  topic: string;
  memberCount: number;
  humanName: string;
  group: GroupCard;
  updatedAt: number;
}

export interface ChatVerseState {
  isLibraryReady: boolean;
  groups: GroupSummary[];
  deleteGroup: (groupId: string) => Promise<void>;
  importGroup: (file: File) => Promise<LibraryGroupRecord>;
  exportGroup: (groupId: string) => Promise<void>;
}
