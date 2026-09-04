import { describe, expect, it } from "vitest";
import { conversationRuntimeState } from "./conversationRuntime";

describe("conversationRuntimeState", () => {
  it("treats a dormant Group as waiting to start", () => {
    expect(conversationRuntimeState("group", "dormant")).toEqual({
      active: false,
      paused: false,
      stopped: false,
      canStart: true,
      canSend: false,
    });
  });

  it("allows only an active Group to send autonomously", () => {
    expect(conversationRuntimeState("group", "active")).toMatchObject({
      active: true,
      canStart: false,
      canSend: true,
    });
    expect(conversationRuntimeState("group", "paused").canSend).toBe(false);
  });

  it("keeps private chat ask-response available while dormant", () => {
    expect(conversationRuntimeState("private", "dormant")).toMatchObject({
      active: false,
      canStart: false,
      canSend: true,
    });
  });
});
