import type {
  ChatProvider,
  ProviderRequestContext,
} from "../../contracts/provider.js";
import { HARNESS_DECISION_JSON_SYSTEM_PROMPT } from "../../context/prompts.js";
import { parseAgentDecisionJson } from "./decision.js";
import type { AgentDecision } from "./decision.js";

export interface HarnessDriverObserver {
  requestContext?: ProviderRequestContext;
  maxTokens?: number;
  onPrompt?(systemPrompt: string, userPrompt: string): void;
  onResponse?(raw: string): void;
  onGenerating(status: "started" | "completed"): void;
  onResponseFormatFallback(error: unknown): void;
  onInvalidDecision(error: unknown, raw: string): void;
}

/**
 * Provider and JSON-repair boundary for Harness decisions.
 *
 * Trigger selection and queue mutations remain in Session; this class only
 * turns one prepared character prompt into a validated decision.
 */
export class HarnessDriver {
  private responseFormatSupported: boolean | undefined;

  constructor(
    private readonly provider: ChatProvider,
    private decisionSystemPrompt: string | undefined = HARNESS_DECISION_JSON_SYSTEM_PROMPT,
  ) {}

  setDecisionSystemPrompt(prompt: string | undefined): void {
    this.decisionSystemPrompt = prompt;
  }

  async decide(
    systemPrompt: string,
    userPrompt: string,
    observer: HarnessDriverObserver,
    signal?: AbortSignal,
  ): Promise<AgentDecision> {
    const raw = await this.complete(systemPrompt, userPrompt, observer, signal);
    try {
      return parseAgentDecisionJson(raw);
    } catch (error) {
      observer.onInvalidDecision(error, raw);
      const repairPrompt = [
        userPrompt,
        "",
        "[Previous output was not valid JSON]",
        `Previous output: ${truncate(raw, 500)}`,
        "Return one valid JSON object only. Do not add an explanation or code fence.",
      ].join("\n");
      const repairedRaw = await this.complete(systemPrompt, repairPrompt, observer, signal);
      try {
        return parseAgentDecisionJson(repairedRaw);
      } catch (repairError) {
        observer.onInvalidDecision(repairError, repairedRaw);
        // Parsing failure is an expected model-output fault, not a Session
        // failure. The scheduler can safely retry after the normal idle delay.
        return { type: "silent", reason: "invalid decision JSON after retry" };
      }
    }
  }

  private async complete(
    systemPrompt: string,
    userPrompt: string,
    observer: HarnessDriverObserver,
    signal?: AbortSignal,
  ): Promise<string> {
    observer.onGenerating("started");
    try {
      const decisionSystemPrompt = `${systemPrompt}\n\n${this.decisionSystemPrompt ?? HARNESS_DECISION_JSON_SYSTEM_PROMPT}`;
      observer.onPrompt?.(decisionSystemPrompt, userPrompt);
      const complete = async (request: Parameters<ChatProvider["complete"]>[0]): Promise<string> => {
        const response = await this.provider.complete(request);
        observer.onResponse?.(response);
        return response;
      };
      if (this.responseFormatSupported === false) {
        return await complete({
          systemPrompt: decisionSystemPrompt,
          userPrompt,
          maxTokens: observer.maxTokens ?? 700,
          thinking: "disabled",
          requestContext: observer.requestContext,
          signal,
        });
      }
      try {
        const response = await complete({
          systemPrompt: decisionSystemPrompt,
          userPrompt,
          maxTokens: observer.maxTokens ?? 700,
          responseFormat: { type: "json_object" },
          thinking: "disabled",
          requestContext: observer.requestContext,
          signal,
        });
        this.responseFormatSupported = true;
        return response;
      } catch (error) {
        if (!isResponseFormatUnsupported(error)) throw error;
        this.responseFormatSupported = false;
        observer.onResponseFormatFallback(error);
        return await complete({
          systemPrompt: decisionSystemPrompt,
          userPrompt,
          maxTokens: observer.maxTokens ?? 700,
          thinking: "disabled",
          requestContext: observer.requestContext,
          signal,
        });
      }
    } finally {
      observer.onGenerating("completed");
    }
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function isResponseFormatUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const text = `${String(candidate.code ?? "")} ${String(candidate.message ?? "")}`;
  return (
    (status === 400 || status === 404 || status === 422) &&
    /(response.?format|json.?object|json.?mode)/i.test(text)
  );
}
