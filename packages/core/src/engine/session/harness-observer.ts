import type { DebugEmitter } from "../../observability/debug/index.js";
import type { RuntimeNotification } from "../../runtime/index.js";
import type { HarnessDriverObserver } from "../harness/driver.js";
import { errorToMessage, truncateText } from "./helpers.js";

export interface HarnessObserverHost {
  readonly debug: DebugEmitter;
  notify(
    type: Extract<RuntimeNotification["type"], "agent.generating" | "agent.error">,
    payload: Record<string, unknown>,
  ): void;
}

export function createHarnessObserver(
  host: HarnessObserverHost,
  input: {
    characterName: string;
    actorId?: string;
    contextId?: string;
    turnId?: string;
    historyCount: number;
    maxTokens?: number;
  },
): HarnessDriverObserver {
  return {
    requestContext: {
      purpose: "actor_decision",
      contextId: input.contextId,
      actorId: input.actorId,
      characterName: input.characterName,
      turnId: input.turnId,
    },
    maxTokens: input.maxTokens,
    onPrompt: (systemPrompt: string, userPrompt: string) => {
      host.debug.emit({
        type: "character.prompt_built",
        characterName: input.characterName,
        historyCount: input.historyCount,
        systemPrompt: host.debug.shouldTracePrompts ? systemPrompt : undefined,
        userPrompt: host.debug.shouldTracePrompts ? userPrompt : undefined,
      });
    },
    onResponse: (raw: string) => {
      host.debug.emit({
        type: "character.response_completed",
        characterName: input.characterName,
        message: host.debug.shouldTraceResponses ? raw : undefined,
      });
    },
    onGenerating: (status: "started" | "completed") => {
      host.notify("agent.generating", {
        agent: "character",
        characterName: input.characterName,
        status,
      });
    },
    onResponseFormatFallback: (error: unknown) => {
      const message = errorToMessage(error);
      host.debug.emit({
        type: "agent.error",
        agent: "character",
        message: `${input.characterName} harness response_format failed, retrying without JSON mode: ${message}`,
      });
      host.notify("agent.error", {
        agent: "character",
        characterName: input.characterName,
        message,
      });
    },
    onInvalidDecision: (error: unknown, raw: string) => {
      host.debug.emit({
        type: "agent.error",
        agent: "character",
        message: `${input.characterName} harness decision invalid JSON, retrying once: ${errorToMessage(error)} raw=${truncateText(raw, 220)}`,
      });
    },
  };
}
