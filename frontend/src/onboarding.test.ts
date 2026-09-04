import { describe, expect, it } from "vitest";
import { ONBOARDING_STORAGE_KEY, readOnboardingState, setOnboardingChapterStatus } from "./onboarding";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("onboarding state", () => {
  it("starts every chapter as pending", () => {
    expect(readOnboardingState(new MemoryStorage())).toEqual({
      version: 1,
      chapters: { home: "pending", models: "pending", world: "pending" },
    });
  });

  it("updates one chapter without changing the rest", () => {
    const storage = new MemoryStorage();
    setOnboardingChapterStatus("models", "completed", storage);
    expect(JSON.parse(storage.values.get(ONBOARDING_STORAGE_KEY) ?? "{}").chapters).toEqual({
      home: "pending",
      models: "completed",
      world: "pending",
    });
  });

  it("recovers from malformed browser data", () => {
    const storage = new MemoryStorage();
    storage.setItem(ONBOARDING_STORAGE_KEY, "broken");
    expect(readOnboardingState(storage).chapters.home).toBe("pending");
  });
});
