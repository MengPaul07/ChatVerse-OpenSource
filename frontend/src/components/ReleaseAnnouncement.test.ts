import { describe, expect, it } from "vitest";
import {
  CURRENT_RELEASE_ANNOUNCEMENT,
  hasSeenReleaseAnnouncement,
  markReleaseAnnouncementSeen,
} from "./ReleaseAnnouncement";

describe("release announcement", () => {
  it("uses the announcement id as the read-version marker", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    expect(hasSeenReleaseAnnouncement(storage)).toBe(false);
    markReleaseAnnouncementSeen(storage);
    expect(hasSeenReleaseAnnouncement(storage)).toBe(true);
    expect(values.values().next().value).toBe(CURRENT_RELEASE_ANNOUNCEMENT.id);
  });

  it("does not make storage failures block the workspace", () => {
    const brokenStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(hasSeenReleaseAnnouncement(brokenStorage)).toBe(false);
    expect(() => markReleaseAnnouncementSeen(brokenStorage)).not.toThrow();
  });
});
