import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../../contracts/provider.js";
import { HarnessDriver } from "./driver.js";

function createProvider(outputs: string[]): ChatProvider {
  return {
    async complete() {
      return outputs.shift() ?? "";
    },
    async *stream() { /* not used */ },
    async chat() {
      return { content: "", toolCalls: [] };
    },
  };
}

function createObserver() {
  const invalid: string[] = [];
  return {
    observer: {
      onGenerating() {},
      onResponseFormatFallback() {},
      onInvalidDecision(_error: unknown, raw: string) {
        invalid.push(raw);
      },
    },
    invalid,
  };
}

describe("HarnessDriver JSON recovery", () => {
  it("disables reasoning for structured Actor decisions", async () => {
    let thinking: "enabled" | "disabled" | undefined;
    const provider: ChatProvider = {
      async complete(input) {
        thinking = input.thinking;
        return '{"type":"silent","reason":"test"}';
      },
      async *stream() { /* not used */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const { observer } = createObserver();

    await new HarnessDriver(provider).decide("system", "user", observer);

    expect(thinking).toBe("disabled");
  });

  it("repairs one invalid decision response", async () => {
    const { observer, invalid } = createObserver();
    const decision = await new HarnessDriver(createProvider([
      "not valid JSON",
      '{"type":"perform","items":[{"kind":"message","message":"我看到了。"}]}',
    ])).decide("system", "user", observer);

    expect(decision).toEqual({
      type: "perform",
      items: [{ kind: "message", message: "我看到了。" }],
      hesitationSec: undefined,
      idleCooldownSec: undefined,
      statePatch: undefined,
      reason: undefined,
    });
    expect(invalid).toEqual(["not valid JSON"]);
  });

  it("returns a silent decision after the single JSON retry also fails", async () => {
    const { observer, invalid } = createObserver();
    const decision = await new HarnessDriver(createProvider([
      "not valid JSON",
      "still not JSON",
    ])).decide("system", "user", observer);

    expect(decision).toEqual({ type: "silent", reason: "invalid decision JSON after retry" });
    expect(invalid).toEqual(["not valid JSON", "still not JSON"]);
  });

  it("does not repeat a Provider request for an unrelated failure", async () => {
    let calls = 0;
    const failingProvider: ChatProvider = {
      async complete() {
        calls++;
        throw new Error("network unavailable");
      },
      async *stream() { /* not used */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const { observer } = createObserver();

    await expect(
      new HarnessDriver(failingProvider).decide("system", "user", observer),
    ).rejects.toThrow("network unavailable");
    expect(calls).toBe(1);
  });

  it("falls back once when JSON response format is explicitly unsupported", async () => {
    let calls = 0;
    const formats: boolean[] = [];
    const fallbackProvider: ChatProvider = {
      async complete({ responseFormat }) {
        calls++;
        formats.push(Boolean(responseFormat));
        if (responseFormat) {
          throw Object.assign(new Error("response_format json_object unsupported"), { status: 400 });
        }
        return '{"type":"silent","reason":"nothing to add"}';
      },
      async *stream() { /* not used */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const { observer } = createObserver();

    const driver = new HarnessDriver(fallbackProvider);
    const decision = await driver.decide(
      "system",
      "user",
      observer,
    );
    await driver.decide("system", "another turn", observer);
    expect(decision).toEqual({ type: "silent", reason: "nothing to add" });
    expect(calls).toBe(3);
    expect(formats).toEqual([true, false, false]);
  });

  it("supports a World-specific decision protocol without changing the default driver", async () => {
    let receivedSystemPrompt = "";
    const provider: ChatProvider = {
      async complete({ systemPrompt }) {
        receivedSystemPrompt = systemPrompt;
        return '{"type":"perform","items":[{"kind":"action","action":"抬头望向山道"}]}';
      },
      async *stream() { /* not used */ },
      async chat() { return { content: "", toolCalls: [] }; },
    };
    const { observer } = createObserver();

    await new HarnessDriver(provider, "【World Actor 决策协议】").decide(
      "角色身份",
      "世界事件",
      observer,
    );

    expect(receivedSystemPrompt).toContain("【World Actor 决策协议】");
    expect(receivedSystemPrompt).not.toContain("你现在在为 ChatVerse 返回一次角色发言决策");
  });
});
