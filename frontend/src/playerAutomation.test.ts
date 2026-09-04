import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  readPlayerAutoPerformance,
  savePlayerAutoPerformance,
} from "./playerAutomation";

const storage = new Map<string, string>();
const listeners = new Set<() => void>();
const originalWindow = (globalThis as { window?: unknown }).window;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => {
      for (const listener of listeners) listener();
      return true;
    },
  },
});

beforeEach(() => {
  storage.clear();
  listeners.clear();
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

describe("player automation preference", () => {
  it("shares one persisted value across world and stage consumers", () => {
    expect(readPlayerAutoPerformance()).toBe(false);
    savePlayerAutoPerformance(true);
    expect(readPlayerAutoPerformance()).toBe(true);
    savePlayerAutoPerformance(false);
    expect(readPlayerAutoPerformance()).toBe(false);
  });
});
