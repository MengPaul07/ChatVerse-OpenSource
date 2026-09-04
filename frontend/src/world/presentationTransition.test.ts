import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginPresentationTransition,
  clearPresentationTransition,
  pendingPresentationTransition,
} from "./presentationTransition";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("presentation transition", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only exposes a transition to its exact destination", () => {
    beginPresentationTransition({
      roomId: "room-a",
      contextId: "main",
      target: "stage",
      resumeAfterLoad: true,
      createdAt: Date.now(),
    });

    expect(pendingPresentationTransition("room-a", "main", "world")).toBeUndefined();
    expect(pendingPresentationTransition("room-b", "main", "stage")).toBeUndefined();
    expect(pendingPresentationTransition("room-a", "main", "stage")?.resumeAfterLoad).toBe(true);
  });

  it("clears consumed and expired transitions", () => {
    beginPresentationTransition({
      roomId: "room-a",
      contextId: "main",
      target: "world",
      resumeAfterLoad: false,
      createdAt: Date.now() - 61_000,
    });
    expect(pendingPresentationTransition("room-a", "main", "world")).toBeUndefined();

    beginPresentationTransition({
      roomId: "room-a",
      contextId: "main",
      target: "world",
      resumeAfterLoad: false,
      createdAt: Date.now(),
    });
    clearPresentationTransition();
    expect(pendingPresentationTransition("room-a", "main", "world")).toBeUndefined();
  });
});
