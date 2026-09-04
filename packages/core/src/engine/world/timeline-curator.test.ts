import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../../contracts/provider.js";
import { TimelineCurator } from "./timeline-curator.js";

describe("TimelineCurator", () => {
  it("includes the previous checkpoint when rebuilding the compressed timeline", async () => {
    let userPrompt = "";
    const provider: ChatProvider = {
      async complete(input) {
        userPrompt = input.userPrompt;
        return JSON.stringify({
          summary: "旧桥已经封锁，访客转向档案室，并发现新的封条异常。",
          facts: ["旧桥已封锁", "档案室封条异常"],
        });
      },
      async *stream() {},
      async chat() {
        return { content: "", toolCalls: [] };
      },
    };

    const curator = new TimelineCurator(provider);
    await curator.curate(
      ["【角色】：档案室的封条与登记表编号不一致。"],
      {
        summary: "访客已经在旧桥发现一盏熄灭的信号灯。",
        facts: ["旧桥有一盏熄灭的信号灯"],
      },
    );

    expect(userPrompt).toContain("访客已经在旧桥发现一盏熄灭的信号灯。");
    expect(userPrompt).toContain("旧桥有一盏熄灭的信号灯");
    expect(userPrompt).toContain("档案室的封条与登记表编号不一致");
  });

  it("falls back only for unsupported JSON mode and repairs malformed output once", async () => {
    const formats: boolean[] = [];
    let plainCalls = 0;
    const provider: ChatProvider = {
      async complete(input) {
        formats.push(Boolean(input.responseFormat));
        if (input.responseFormat) {
          throw Object.assign(new Error("response_format json mode unsupported"), { status: 400 });
        }
        plainCalls++;
        if (plainCalls === 1) return '{"summary":';
        return JSON.stringify({ summary: "完整摘要。", facts: [] });
      },
      async *stream() {},
      async chat() { return { content: "", toolCalls: [] }; },
    };

    const curator = new TimelineCurator(provider);
    await expect(curator.curate(["新增事件"])).resolves.toEqual({
      summary: "完整摘要。",
      facts: [],
    });
    expect(formats).toEqual([true, false, false]);
  });
});
