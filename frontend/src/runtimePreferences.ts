import { providerRequestHeaders } from "./providerSettings";

export interface RuntimePreferences {
  autoPauseEnabled: boolean;
  autoPauseAfterMinutes: number;
}

export const RUNTIME_PREFERENCES_CHANGED = "chatverse:runtime-preferences-changed";
const STORAGE_KEY = "chatverse:runtime-preferences:v1";
const DEFAULT_PREFERENCES: RuntimePreferences = {
  autoPauseEnabled: true,
  autoPauseAfterMinutes: 5,
};

export function readRuntimePreferences(): RuntimePreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<RuntimePreferences> | null;
    return normalizeRuntimePreferences(value ?? {});
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveRuntimePreferences(input: RuntimePreferences): RuntimePreferences {
  const next = normalizeRuntimePreferences(input);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(RUNTIME_PREFERENCES_CHANGED, { detail: next }));
  return next;
}

export async function syncRoomRuntimePreferences(
  roomId: string,
  preferences = readRuntimePreferences(),
): Promise<void> {
  const response = await fetch(`/api/v1/worlds/${encodeURIComponent(roomId)}/runtime-policy`, {
    method: "POST",
    headers: providerRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      autoPauseEnabled: preferences.autoPauseEnabled,
      autoPauseAfterMinutes: preferences.autoPauseAfterMinutes,
    }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("无法同步世界自动暂停设置。");
  }
}

function normalizeRuntimePreferences(input: Partial<RuntimePreferences>): RuntimePreferences {
  const minutes = typeof input.autoPauseAfterMinutes === "number" && Number.isFinite(input.autoPauseAfterMinutes)
    ? Math.max(1, Math.min(120, input.autoPauseAfterMinutes))
    : DEFAULT_PREFERENCES.autoPauseAfterMinutes;
  return {
    autoPauseEnabled: input.autoPauseEnabled !== false,
    autoPauseAfterMinutes: minutes,
  };
}
