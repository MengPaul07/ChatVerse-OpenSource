const STORAGE_KEY = "chatverse:world-entry-preferences:v1";

export type StoredEntryMode = "world" | "stage";

interface WorldEntryPreference {
  configuredAt: number;
  mode: StoredEntryMode;
}

type WorldEntryPreferences = Record<string, WorldEntryPreference>;

export function worldEntryPreference(archiveId: string): WorldEntryPreference | undefined {
  return readPreferences()[archiveId];
}

export function markWorldEntryConfigured(archiveId: string, mode: StoredEntryMode): void {
  const preferences = readPreferences();
  preferences[archiveId] = { configuredAt: Date.now(), mode };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function readPreferences(): WorldEntryPreferences {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as WorldEntryPreferences
      : {};
  } catch {
    return {};
  }
}
