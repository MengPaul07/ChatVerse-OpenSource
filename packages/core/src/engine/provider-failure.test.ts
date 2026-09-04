import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "../adapters/providers/provider-errors.js";
import { blockingProviderIssue, providerFailureDetails } from "./provider-failure.js";

describe("blockingProviderIssue", () => {
  it("classifies billing, authentication, permission, and configuration failures", () => {
    expect(blockingProviderIssue(Object.assign(new Error("Payment required"), { status: 402 }))?.kind)
      .toBe("billing");
    expect(blockingProviderIssue(Object.assign(new Error("invalid key"), { status: 401 }))?.kind)
      .toBe("authentication");
    expect(blockingProviderIssue(Object.assign(new Error("forbidden"), { status: 403 }))?.kind)
      .toBe("permission");
    expect(blockingProviderIssue(Object.assign(new Error("model missing"), { status: 404 }))?.kind)
      .toBe("configuration");
  });

  it("keeps temporary rate limits and server failures retryable", () => {
    expect(blockingProviderIssue(Object.assign(new Error("rate limit reached"), { status: 429 })))
      .toBeUndefined();
    expect(blockingProviderIssue(Object.assign(new Error("upstream unavailable"), { status: 503 })))
      .toBeUndefined();
  });

  it("uses the adapter's normalized error code for actionable failures", () => {
    const error = normalizeProviderError(
      Object.assign(new Error("payment required"), { status: 402 }),
      { protocol: "openai-chat", provider: "test", model: "model" },
    );

    expect(blockingProviderIssue(error)).toMatchObject({
      kind: "billing",
      code: "provider_quota_exceeded",
    });
  });

  it("redacts credentials from diagnostic messages", () => {
    const details = providerFailureDetails(new Error("api_key=secret-token Bearer abc.def"));
    expect(details.message).not.toContain("secret-token");
    expect(details.message).not.toContain("abc.def");
  });
});
