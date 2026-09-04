import type {
  NarrativeBeat,
  PresentationRuntimeSnapshot,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { ChatContextRuntime } from "../runtime/context-runtime.js";
import type { PresentationController } from "./controller.js";
import {
  clampInteger,
  type ResolvedBeatRuntimeConfig,
} from "../runtime/config.js";

type WorldRuntimeStatus = "idle" | "running" | "paused" | "stopped";

interface ContextPresentationHost {
  presentation: Pick<
    PresentationController,
    "mode" | "setMode" | "setTimingBypass" | "setPrefetchLimit"
  >;
  getContext(contextId: string): ChatContextRuntime | undefined;
  getActiveBeat(contextId: string): NarrativeBeat | undefined;
  getStatus(): WorldRuntimeStatus;
  assertNotStopped(operation: string): void;
  scheduleNarrator(contextId: string): void;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
}

/** Owns Context pacing, stage mode and presentation prefetch settings. */
export class ContextPresentationRuntime {
  private readonly presentationPacing = new Map<string, number>();

  constructor(private readonly host: ContextPresentationHost) {}

  isStagePacingOverride(contextId: string): boolean {
    return this.host.presentation.mode(contextId) === "stage";
  }

  initialize(
    contextIds: readonly string[],
    snapshots: readonly PresentationRuntimeSnapshot[],
  ): void {
    const snapshotByContext = new Map(snapshots.map((snapshot) => [snapshot.contextId, snapshot]));
    for (const contextId of contextIds) {
      const context = this.host.getContext(contextId);
      if (!context) continue;
      if (context.definition.presentation?.kind !== "galgame") continue;
      const snapshot = snapshotByContext.get(contextId);
      const normalPacing = snapshot?.normalPacingMultiplier ?? context.session.pacingMultiplier;
      this.presentationPacing.set(contextId, normalPacing);
      this.host.presentation.setMode(contextId, snapshot?.mode ?? "world", normalPacing);
      // Presentation owns reading cadence. The Session only generates and
      // commits complete turns, so switching surfaces never rewrites its queue.
      context.session.setPacingMultiplier(0, true);
      if (snapshot?.mode === "stage") this.host.presentation.setTimingBypass(contextId, true);
    }
  }

  getPacingMultiplier(contextId: string): number {
    const context = this.requireContext(contextId);
    return this.presentationPacing.get(contextId) ?? context.session.pacingMultiplier;
  }

  setPacingMultiplier(contextId: string, value: number): number {
    this.host.assertNotStopped("change Context pacing");
    const context = this.requireContext(contextId);
    if (!Number.isFinite(value)) throw new Error("pacingMultiplier must be finite.");
    const next = Math.min(20, Math.max(0, value));
    const presentationContext = context.definition.presentation?.kind === "galgame";
    const previous = presentationContext
      ? this.presentationPacing.get(contextId) ?? context.session.pacingMultiplier
      : context.session.pacingMultiplier;
    if (next === previous) return next;

    if (presentationContext) {
      this.presentationPacing.set(contextId, next);
      this.host.presentation.setMode(contextId, this.host.presentation.mode(contextId), next);
      context.session.setPacingMultiplier(0, true);
    } else {
      context.session.setPacingMultiplier(next);
    }
    context.definition.runtime = {
      ...context.definition.runtime,
      pacingMultiplier: next,
    };
    this.host.notify("context.pacing_changed", {
      contextId,
      pacingMultiplier: next,
      previousPacingMultiplier: previous,
    });
    return next;
  }

  setMode(contextId: string, mode: "world" | "stage"): "world" | "stage" {
    this.host.assertNotStopped("change Context presentation mode");
    const context = this.requireContext(contextId);
    const active = mode === "stage";
    const currentMode = this.host.presentation.mode(contextId);
    if (currentMode === mode) return mode;
    const presentationContext = context.definition.presentation?.kind === "galgame";
    if (presentationContext) {
      const normalPacing = this.presentationPacing.get(contextId) ?? context.session.pacingMultiplier;
      this.presentationPacing.set(contextId, normalPacing);
      this.host.presentation.setMode(contextId, mode, normalPacing);
      context.session.setPacingMultiplier(0, true);
      if (active) this.host.presentation.setTimingBypass(contextId, true);
    } else if (active) {
      this.host.presentation.setMode(contextId, "stage", context.session.pacingMultiplier);
      context.session.setPacingMultiplier(0, true);
      this.host.presentation.setTimingBypass(contextId, true);
    } else {
      this.host.presentation.setMode(contextId, "world");
    }
    if (active && this.host.getStatus() === "running" && this.host.getActiveBeat(contextId)) {
      this.host.scheduleNarrator(contextId);
    }
    return mode;
  }

  setPolicy(
    contextId: string,
    input: { presentationPrefetchLimit?: number },
  ): ResolvedBeatRuntimeConfig {
    this.host.assertNotStopped("change Context presentation policy");
    const context = this.requireContext(contextId);
    if (input.presentationPrefetchLimit != null) {
      context.beatRuntime.presentationPrefetchLimit = clampInteger(
        input.presentationPrefetchLimit,
        5,
        0,
        10,
      );
      this.host.presentation.setPrefetchLimit(
        contextId,
        context.beatRuntime.presentationPrefetchLimit,
      );
    }
    return {
      ...context.beatRuntime,
      retryBackoffMs: [...context.beatRuntime.retryBackoffMs],
    };
  }

  private requireContext(contextId: string): ChatContextRuntime {
    const context = this.host.getContext(contextId);
    if (!context) throw new Error(`Unknown Context: ${contextId}`);
    return context;
  }
}
