import {
  createStudioBenchV1Scenarios,
  type StudioBenchmarkScenario,
} from "./studio.js";
import {
  createWorldBenchV1Scenarios,
} from "./scenarios.js";
import type { BenchmarkScenario } from "./types.js";

/** The version of the complete CVWB catalog, independent of engine revisions. */
export const CVWB_SUITE_VERSION = "1.0.0";

export interface CVWBSuiteRegistry {
  version: string;
  world: readonly BenchmarkScenario[];
  studio: readonly StudioBenchmarkScenario[];
}

export type CVWBScenarioRef =
  | { profile: "world"; scenario: BenchmarkScenario }
  | { profile: "studio"; scenario: StudioBenchmarkScenario };

/**
 * Return the single source of truth for every published CVWB scenario.
 *
 * Callers should select a profile from this registry instead of importing
 * individual scenarios from unrelated scripts. The arrays are freshly created
 * so a runner can safely adjust action timing for one run.
 */
export function createCVWBSuiteRegistry(): CVWBSuiteRegistry {
  return {
    version: CVWB_SUITE_VERSION,
    world: createWorldBenchV1Scenarios(),
    studio: createStudioBenchV1Scenarios(),
  };
}

export function findCVWBScenario(id: string): CVWBScenarioRef | undefined {
  const registry = createCVWBSuiteRegistry();
  const world = registry.world.find((scenario) => scenario.id === id);
  if (world) return { profile: "world", scenario: world };
  const studio = registry.studio.find((scenario) => scenario.id === id);
  return studio ? { profile: "studio", scenario: studio } : undefined;
}
