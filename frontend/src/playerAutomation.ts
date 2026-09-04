import { useCallback, useEffect, useState } from "react";

export const PLAYER_AUTOMATION_CHANGED = "chatverse:player-automation-changed";
const STORAGE_KEY = "chatverse:player-auto-performance:v1";

export function readPlayerAutoPerformance(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function savePlayerAutoPerformance(enabled: boolean): boolean {
  const next = enabled === true;
  window.localStorage.setItem(STORAGE_KEY, String(next));
  window.dispatchEvent(new CustomEvent(PLAYER_AUTOMATION_CHANGED, { detail: next }));
  return next;
}

export function usePlayerAutoPerformance(): readonly [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(readPlayerAutoPerformance);

  useEffect(() => {
    const sync = () => setEnabled(readPlayerAutoPerformance());
    window.addEventListener(PLAYER_AUTOMATION_CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PLAYER_AUTOMATION_CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((next: boolean) => {
    setEnabled(savePlayerAutoPerformance(next));
  }, []);

  return [enabled, update];
}
