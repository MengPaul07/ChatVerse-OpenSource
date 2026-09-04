import type { WorldSourceAdherence } from "./source.js";

export type NarrativeEdgeType =
  | "causes"
  | "enables"
  | "contradicts"
  | "escalates"
  | "resolves"
  | "returns_to";

/** Director's durable chapter plan. The treatment is never sent to scene agents. */
export interface NarrativeChapter {
  id: string;
  title: string;
  /** A 600–1500 character treatment for a multi-Beat chapter. */
  treatment: string;
  /** One observable, world-changing result that closes the chapter. */
  targetOutcome: string;
  status: "queued" | "active" | "completed" | "abandoned";
  actorIds: string[];
  contextIds: string[];
  beatIds: string[];
  outcome?: string;
}

/** A temporary Actor prepared as part of one Beat plan. */
export interface NarrativeBeatSceneActor {
  actorId: string;
  contextId: string;
  name: string;
  role: string;
  personality: string;
  objective: string;
  entrance: string;
  required: boolean;
  sourceEventIds: string[];
}

export interface NarrativeBeatStage {
  id: string;
  purpose: string;
  entryCondition: string;
  developments: string[];
  expectedChange: string;
}

export interface NarrativeBeatScript {
  /** Concrete time or phase in which the scene occurs. */
  time: string;
  /** Concrete place and relevant spatial boundary. */
  location: string;
  /** Participants and the dramatic responsibility each has in this scene. */
  cast: Array<{ actorId: string; roleInScene: string }>;
  /** Established event or condition that directly starts this scene. */
  cause: string;
  /** Ordered, Director-approved causal developments. */
  development: string[];
  /** Concrete event that changes the available choices. */
  turningPoint: string;
  /** Predetermined observable result that closes this scene. */
  result: string;
  /** Explicit causal links from cause through development to result. */
  causalChain: string[];
  /** Optional scene-only Actors atomically prepared with this Beat. */
  sceneActors?: NarrativeBeatSceneActor[];
  /** Concrete opening state, objectives, and staged execution plan. */
  openingState?: string;
  objective?: string;
  conflict?: string;
  stakes?: string;
  stages?: NarrativeBeatStage[];
  climax?: string;
  nextPressure?: string;
}

export interface NarrativeBeatSourceBasis {
  /** Revisions are frozen when the World instance is created. */
  bundleId: string;
  bindingRevision: number;
  chunkIds: string[];
  adherence: WorldSourceAdherence;
  note?: string;
}

export interface NarrativeBeat {
  id: string;
  chapterId: string;
  title: string;
  /** Frozen stage contract authored by the Director. */
  brief: string;
  /** Executable scene-level plot authored by the reasoning Director. */
  script: NarrativeBeatScript;
  /** Whether completing this Beat also closes its Chapter. */
  completesChapter: boolean;
  /** Minimum visible Actor/player turns before this Beat may close. One output burst is one turn. */
  minimumActorTurns: number;
  /** Maximum visible Actor/player turns before closure must be driven immediately. */
  maximumActorTurns: number;
  status: "prepared" | "running" | "completed";
  outcome?: string;
  actorIds: string[];
  contextIds: string[];
  sourceEventIds: string[];
  /** Optional authoring-source provenance used by the Director for this Beat. */
  sourceBasis?: NarrativeBeatSourceBasis;
  /** How much narrative space this Beat is intended to occupy. */
  kind?: "full_scene" | "transition" | "coda";
  occurredAt: number;
  completedAt?: number;
}

export interface NarrativeNarration {
  id: string;
  contextId: string;
  text: string;
  sourceEventIds: string[];
  occurredAt: number;
  /** User-authored narration is committed directly instead of joining the presentation queue. */
}

export interface NarrativeEdge {
  id: string;
  fromBeatId: string;
  toBeatId: string;
  type: NarrativeEdgeType;
  description?: string;
  createdAt: number;
}

/**
 * A compact, derived view of one context's conversational continuity.
 *
 * The durable source remains the Context Session's ConversationDigest and
 * message history. This projection is only the small slice exposed to a
 * World Director pass; it is deliberately not another memory graph.
 */
export interface ContextContinuity {
  contextId: string;
  text: string;
  throughMessageId?: string;
}
