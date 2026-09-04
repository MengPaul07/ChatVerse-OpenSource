import { toBenchmarkObservation as project } from "@chatverse/world-benchmark";
import type { BenchmarkObservation } from "@chatverse/world-benchmark";
import type { WorldRunReport } from "./types.js";

/** Project the current Lab report into the stable CVWB observation protocol. */
export function toBenchmarkObservation(report: WorldRunReport): BenchmarkObservation {
  return project(report, {
    adapterName: "chatverse-world-run-lab",
    capabilities: [
      "scene_arbitration",
      "actor_performance",
      "macro_progression",
      "scene_actor_planning",
      "macro_dismiss",
      "context_inspection",
      "narrative_retrieval",
      "world_time",
      "snapshot_restore",
      "fault_recovery",
    ],
  });
}
