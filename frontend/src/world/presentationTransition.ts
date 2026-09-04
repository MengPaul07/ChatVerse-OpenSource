export type PresentationTargetMode = "world" | "stage";

interface PendingPresentationTransition {
  roomId: string;
  contextId: string;
  target: PresentationTargetMode;
  resumeAfterLoad: boolean;
  createdAt: number;
}

const KEY = "chatverse:presentation-transition:v1";
const MAX_AGE_MS = 60_000;

export function beginPresentationTransition(input: PendingPresentationTransition): void {
  window.sessionStorage.setItem(KEY, JSON.stringify(input));
}

export function pendingPresentationTransition(
  roomId: string,
  contextId: string,
  target: PresentationTargetMode,
): PendingPresentationTransition | undefined {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as PendingPresentationTransition | null;
    if (!value || Date.now() - value.createdAt > MAX_AGE_MS) {
      clearPresentationTransition();
      return undefined;
    }
    return value.roomId === roomId && value.contextId === contextId && value.target === target
      ? value
      : undefined;
  } catch {
    clearPresentationTransition();
    return undefined;
  }
}

export function clearPresentationTransition(): void {
  window.sessionStorage.removeItem(KEY);
}
