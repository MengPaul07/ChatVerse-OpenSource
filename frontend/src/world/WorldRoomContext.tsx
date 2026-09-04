import { createContext, useContext } from "react";
import type { useWorldRoom } from "./useWorldRoom";

export type WorldRoomController = ReturnType<typeof useWorldRoom>;

export const WorldRoomContext = createContext<WorldRoomController | null>(null);

export function useWorldRoomContext(): WorldRoomController {
  const room = useContext(WorldRoomContext);
  if (!room) {
    throw new Error("useWorldRoomContext must be used inside WorldRoomProvider");
  }
  return room;
}
