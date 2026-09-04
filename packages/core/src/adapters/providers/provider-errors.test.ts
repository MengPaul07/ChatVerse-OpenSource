import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "./provider-errors.js";

describe("provider error normalization", () => {
  it.each([
    [401, "provider_auth_failed", false],
    [402, "provider_quota_exceeded", false],
    [429, "provider_rate_limited", true],
    [404, "provider_unsupported", false],
    [500, "provider_server_error", true],
  ] as const)("maps HTTP %s to %s", (status, code, retryable) => {
    const error = normalizeProviderError(Object.assign(new Error("upstream detail"), { status }), {
      protocol: "anthropic-messages",
      provider: "Anthropic",
      model: "claude-test",
    });

    expect(error).toMatchObject({ code, status, retryable, protocol: "anthropic-messages" });
    expect(error.message).not.toContain("upstream detail");
  });

  it("classifies an unsupported model message separately from malformed input", () => {
    const error = normalizeProviderError(new Error("model not found"), {
      protocol: "openai-chat",
    });

    expect(error).toMatchObject({ code: "provider_unsupported", retryable: false });
  });

  it("classifies an adapter timeout as retryable", () => {
    const error = normalizeProviderError(new Error("Provider request timed out after 100ms"), {
      protocol: "openai-chat",
    });

    expect(error).toMatchObject({ code: "provider_timeout", retryable: true });
  });
});
