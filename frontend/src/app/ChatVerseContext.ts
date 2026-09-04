import { createContext, useContext } from "react";
import type { ChatVerseState } from "./state-types";

export const ChatVerseContext = createContext<ChatVerseState | null>(null);

export function useChatVerse() {
  const state = useContext(ChatVerseContext);
  if (!state) throw new Error("useChatVerse must be used inside ChatVerseProvider");
  return state;
}
