import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestSignal, sanitizeToolSchema } from "./provider-utils.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRequestSignal", () => {
  it("treats streaming progress as activity instead of a total request deadline", () => {
    vi.useFakeTimers();
    const request = createRequestSignal(undefined, 100);

    vi.advanceTimersByTime(80);
    request.touch();
    vi.advanceTimersByTime(80);
    expect(request.signal?.aborted).toBe(false);

    vi.advanceTimersByTime(21);
    expect(request.signal?.aborted).toBe(true);
    request.cleanup();
  });
});

describe("sanitizeToolSchema", () => {
  it("applies one unsupported-key policy for every protocol adapter", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", const: "fixed" },
      },
      required: ["name"],
      "$defs": { unused: { type: "string" } },
    };

    expect(sanitizeToolSchema(schema, { supportsFullJsonSchema: false })).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(sanitizeToolSchema(schema, { supportsFullJsonSchema: true })).toBe(schema);
  });
});
