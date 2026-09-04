import { describe, expect, it } from "vitest";
import type { ChatProvider } from "@chatverse/core";
import {
  ProviderConcurrencyGate,
  withProviderConcurrencyGate,
} from "./provider-concurrency-gate.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ProviderConcurrencyGate", () => {
  it("rejects calls above the process-wide limit and releases completed calls", async () => {
    const pending = deferred<string>();
    const provider: ChatProvider = {
      complete: () => pending.promise,
      async *stream() {},
      chat: async () => ({ content: "ok", toolCalls: [] }),
    };
    const factory = withProviderConcurrencyGate(async () => ({
      directorProvider: provider,
      characterProvider: provider,
    }), new ProviderConcurrencyGate(1));
    const firstPair = await factory();
    const secondPair = await factory();

    const first = firstPair.directorProvider.complete({ systemPrompt: "", userPrompt: "" });
    await expect(secondPair.characterProvider.complete({ systemPrompt: "", userPrompt: "" }))
      .rejects.toMatchObject({
        code: "provider_rate_limited",
        status: 429,
        retryable: true,
      });

    pending.resolve("done");
    await expect(first).resolves.toBe("done");
    await expect(secondPair.characterProvider.chat({ messages: [] }))
      .resolves.toMatchObject({ content: "ok" });
  });

  it("holds a slot for the full lifetime of a stream", async () => {
    const pending = deferred<void>();
    const provider: ChatProvider = {
      complete: async () => "ok",
      async *stream() {
        yield "first";
        await pending.promise;
        yield "second";
      },
      chat: async () => ({ content: "ok", toolCalls: [] }),
    };
    const gate = new ProviderConcurrencyGate(1);
    const pair = await withProviderConcurrencyGate(async () => ({
      directorProvider: provider,
      characterProvider: provider,
    }), gate)();
    const iterator = pair.directorProvider.stream({ systemPrompt: "", userPrompt: "" })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ value: "first", done: false });
    expect(gate.activeCount).toBe(1);
    await expect(pair.characterProvider.complete({ systemPrompt: "", userPrompt: "" }))
      .rejects.toMatchObject({ code: "provider_rate_limited" });

    pending.resolve();
    await iterator.return?.();
    expect(gate.activeCount).toBe(0);
  });
});
