/**
 * Actor 的长期记忆是角色实例的主观工作区，不是世界事实本身。
 * WorldEvent 记录发生过什么；这里记录该 Actor 如何理解、保留和关联它。
 */

export type ActorMemoryNodeKind =
  | "self"
  | "belief"
  | "preference"
  | "commitment"
  | "relation"
  | "episode"
  | "knowledge";

export type ActorMemoryNodeStatus = "active" | "superseded" | "archived";

export type ActorMemoryEdgeType =
  | "experienced"
  | "believes"
  | "cares_about"
  | "trusts"
  | "avoids"
  | "causes"
  | "contradicts"
  | "continues";

/** A human-readable memory note. File-based adapters may map this to one Markdown file. */
export interface ActorMemoryNode {
  id: string;
  kind: ActorMemoryNodeKind;
  /** Stable semantic identity used to revise durable memory instead of duplicating it. */
  semanticKey?: string;
  title: string;
  content: string;
  status?: ActorMemoryNodeStatus;
  importance?: number;
  confidence?: number;
  tags?: string[];
  sourceEventIds?: string[];
  createdAt?: number;
  updatedAt?: number;
  lastRecalledAt?: number;
}

/**
 * Edges may point at another memory node or an external world identity, such
 * such as `actor:madoka` or another stable world identity.
 */
export interface ActorMemoryEdge {
  id: string;
  fromNodeId: string;
  toId: string;
  type: ActorMemoryEdgeType;
  weight?: number;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Durable, human-readable memory source. The JSON metadata comment is owned by
 * Core; the heading and body are the text an Actor actually recalls.
 */
export interface ActorMemoryDocument {
  id: string;
  path: string;
  markdown: string;
}

/** Seed data belongs to a shareable actor blueprint. Runtime memories live in an ActorMemorySnapshot. */
export interface ActorMemoryDefinition {
  schemaVersion?: 1;
  documents?: ActorMemoryDocument[];
  nodes?: ActorMemoryNode[];
  edges?: ActorMemoryEdge[];
}

export interface ActorMemoryRecallQuery {
  actorId: string;
  contextId?: string;
  query?: string;
  relatedActorIds?: string[];
  maxNodes?: number;
  /** Relevant relationship notes are selected before the remaining memory budget. */
  maxRelationNodes?: number;
  /** Active commitments may be reserved before general semantic recall. */
  maxCommitmentNodes?: number;
  /** Maintenance-only capacity reserved for archived or superseded notes. */
  maxInactiveNodes?: number;
  maxTokens?: number;
  /** Maintenance callers may inspect cold notes; Actor prompts never enable this. */
  includeInactive?: boolean;
}

export interface ActorMemoryRecall {
  node: ActorMemoryNode;
  score: number;
}

export interface ActorMemorySlice {
  actorId: string;
  entries: ActorMemoryRecall[];
  estimatedTokens: number;
}

export interface ActorMemoryCandidate {
  kind: ActorMemoryNodeKind;
  /** Stable per-Actor topic identity used to revise instead of duplicating. */
  semanticKey: string;
  title: string;
  content: string;
  importance?: number;
  confidence?: number;
  tags?: string[];
  sourceEventIds?: string[];
  links?: Array<{
    toId: string;
    type: ActorMemoryEdgeType;
    weight?: number;
    description?: string;
  }>;
}

export interface ActorMemoryRevision {
  nodeId: string;
  semanticKey?: string;
  title?: string;
  content?: string;
  status?: ActorMemoryNodeStatus;
  importance?: number;
  confidence?: number;
  tags?: string[];
  sourceEventIds?: string[];
}

export interface ActorMemoryLinkCandidate {
  fromNodeId: string;
  toId: string;
  type: ActorMemoryEdgeType;
  weight?: number;
  description?: string;
}

export interface ActorMemoryDeletion {
  nodeId: string;
  sourceEventIds: string[];
  reason?: string;
}

export type ActorMemoryOperation =
  | {
      type: "create";
      candidate: ActorMemoryCandidate;
    }
  | {
      type: "revise";
      revision: ActorMemoryRevision;
    }
  | {
      type: "delete";
      deletion: ActorMemoryDeletion;
    }
  | {
      type: "link";
      link: ActorMemoryLinkCandidate;
    };

/**
 * Curators describe one atomic memory update as a patch. The idempotency key
 * normally represents one Actor plus a contiguous observed WorldEvent range.
 */
export interface ActorMemoryPatch {
  idempotencyKey: string;
  sourceEventIds: string[];
  operations: ActorMemoryOperation[];
}

export interface ActorMemoryCommit {
  actorId: string;
  idempotencyKey: string;
  applied: boolean;
  fromRevision: number;
  toRevision: number;
  createdNodeIds: string[];
  revisedNodeIds: string[];
  deletedNodeIds: string[];
  createdEdgeIds: string[];
  deletedEdgeIds: string[];
}

export interface ActorMemorySnapshot {
  schemaVersion: 1;
  actorId: string;
  revision: number;
  /** Markdown is the durable source; nodes and edges are rebuildable indexes. */
  documents: ActorMemoryDocument[];
  nodes: ActorMemoryNode[];
  edges: ActorMemoryEdge[];
  /** Recent patch keys make retries idempotent across snapshot restoration. */
  appliedPatchIds?: string[];
  updatedAt: number;
}

export interface ActorMemoryRuntimeSnapshot {
  actorId: string;
  lastProcessedSequence: number;
  /** Short-lived evidence waiting for an idle or narrative extraction boundary. */
  pendingEventIds: string[];
  /** Events that explicitly justify a durable-memory extraction pass. */
  candidateEventIds?: string[];
}

/**
 * Storage boundary for Actor Workspace implementations. Core provides an
 * in-memory implementation; Markdown, IndexedDB, SQLite, and server stores
 * can implement this contract without leaking storage concerns into World.
 */
export interface ActorMemoryStore {
  recall(query: ActorMemoryRecallQuery): ActorMemorySlice;
  record(actorId: string, candidate: ActorMemoryCandidate): ActorMemoryNode;
  revise(actorId: string, revision: ActorMemoryRevision): ActorMemoryNode;
  applyTransaction(
    actorId: string,
    patch: ActorMemoryPatch,
    expectedRevision?: number,
  ): ActorMemoryCommit;
  snapshot(actorId: string): ActorMemorySnapshot;
}
