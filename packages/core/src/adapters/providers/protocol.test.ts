import { describe, expect, it } from "vitest";
import { isProviderProtocol, PROVIDER_PROTOCOLS } from "../../contracts/provider.js";

describe("provider protocol registry", () => {
  it("keeps the supported protocol list in one runtime source", () => {
    expect(PROVIDER_PROTOCOLS).toEqual([
      "openai-chat",
      "openai-responses",
      "anthropic-messages",
    ]);
    expect(isProviderProtocol("openai-chat")).toBe(true);
    expect(isProviderProtocol("anthropic-messages")).toBe(true);
    expect(isProviderProtocol("vendor-special")).toBe(false);
  });
});
