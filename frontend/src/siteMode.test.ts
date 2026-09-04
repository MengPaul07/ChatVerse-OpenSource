import { afterAll, describe, expect, it } from "vitest";
import { getSiteModeDomainPolicy, readSiteMode } from "./siteMode";

const originalWindow = (globalThis as { window?: unknown }).window;
const location = { hostname: "localhost" };

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location,
  },
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

describe("site mode", () => {
  it("keeps the root domain on the corporate portal", () => {
    location.hostname = "chatverse.fun";
    expect(readSiteMode()).toBe("portal");
  });

  it("uses the build/domain mode and ignores browser-local state", () => {
    location.hostname = "localhost";
    expect(readSiteMode()).toBe("full");

    location.hostname = "world.chatverse.fun";
    expect(readSiteMode()).toBe("full");
  });

  it("normalizes known production host names", () => {
    expect(getSiteModeDomainPolicy("WWW.ChatVerse.Fun.")).toBe("portal");
    expect(getSiteModeDomainPolicy("WORLD.ChatVerse.Fun.")).toBe("full");
    expect(getSiteModeDomainPolicy("preview.chatverse.fun")).toBe("configurable");
  });
});
