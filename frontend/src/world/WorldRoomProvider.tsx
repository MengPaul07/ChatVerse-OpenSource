import type { PropsWithChildren } from "react";
import { WorldRoomContext } from "./WorldRoomContext";
import { useWorldRoom, type UseWorldRoomOptions } from "./useWorldRoom";

export function WorldRoomProvider({
  options,
  children,
}: PropsWithChildren<{ options: UseWorldRoomOptions }>) {
  const room = useWorldRoom(options);
  return (
    <WorldRoomContext.Provider value={room}>
      {children}
    </WorldRoomContext.Provider>
  );
}
