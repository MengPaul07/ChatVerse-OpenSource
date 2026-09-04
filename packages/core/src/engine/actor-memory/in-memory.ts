import type {
  ActorMemoryCandidate,
  ActorMemoryCommit,
  ActorMemoryDefinition,
  ActorMemoryDocument,
  ActorMemoryEdge,
  ActorMemoryLinkCandidate,
  ActorMemoryNode,
  ActorMemoryPatch,
  ActorMemoryRecall,
  ActorMemoryRecallQuery,
  ActorMemoryRevision,
  ActorMemorySlice,
  ActorMemorySnapshot,
  ActorMemoryStore,
} from "../../contracts/actor-memory.js";
import type { RuntimeHost } from "../../runtime/types.js";

interface ActorMemorySpace {
  actorId: string;
  revision: number;
  updatedAt: number;
  nodes: Map<string, ActorMemoryNode>;
  edges: Map<string, ActorMemoryEdge>;
  documents: Map<string, ActorMemoryDocument>;
  appliedPatchIds: Set<string>;
}

export interface ActorMemorySpaceSeed {
  actorId: string;
  definition?: ActorMemoryDefinition;
  snapshot?: ActorMemorySnapshot;
}

/** Default Core implementation backed by logical Markdown documents and local indexes. */
export class InMemoryActorMemoryStore implements ActorMemoryStore {
  private readonly spaces = new Map<string, ActorMemorySpace>();

  constructor(
    seeds: readonly ActorMemorySpaceSeed[],
    private readonly runtime: RuntimeHost,
  ) {
    for (const seed of seeds) {
      this.registerActor(seed);
    }
  }

  registerActor(seed: ActorMemorySpaceSeed): void {
    if (this.spaces.has(seed.actorId)) {
      throw new Error(`Actor memory space already exists: ${seed.actorId}`);
    }
    this.spaces.set(seed.actorId, createSpace(seed, this.runtime.clock.now()));
  }

  recall(query: ActorMemoryRecallQuery): ActorMemorySlice {
    const space = this.requireSpace(query.actorId);
    const maxNodes = clampInteger(query.maxNodes ?? 3, 1, 12);
    const maxRelationNodes = clampInteger(
      query.maxRelationNodes ?? Math.min(3, maxNodes),
      0,
      maxNodes,
    );
    const maxCommitmentNodes = clampInteger(
      query.maxCommitmentNodes ?? Math.min(2, maxNodes),
      0,
      maxNodes,
    );
    const maxInactiveNodes = query.includeInactive
      ? clampInteger(query.maxInactiveNodes ?? 1, 0, maxNodes)
      : 0;
    const maxTokens = clampInteger(query.maxTokens ?? 280, 40, 1200);
    const terms = extractTerms(query.query ?? "");
    const related = new Set(query.relatedActorIds ?? []);
    const scored = [...space.nodes.values()]
      .filter((node) => (
        query.includeInactive || (node.status ?? "active") === "active"
      ))
      .map((node) => ({ node, score: this.score(space, node, terms, related) }))
      .filter(({ node, score }) => (
        score >= 1.2 ||
        (node.kind === "relation" && this.targetsAny(space, node.id, related))
      ))
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
    const guaranteedRelations = scored
      .filter(({ node }) => (
        node.kind === "relation" &&
        (node.status ?? "active") === "active" &&
        this.targetsAny(space, node.id, related)
      ))
      .slice(0, maxRelationNodes);
    const guaranteedIds = new Set(guaranteedRelations.map(({ node }) => node.id));
    const guaranteedCommitments = scored
      .filter(({ node }) => (
        node.kind === "commitment" &&
        (node.status ?? "active") === "active" &&
        !guaranteedIds.has(node.id)
      ))
      .slice(0, maxCommitmentNodes);
    for (const { node } of guaranteedCommitments) guaranteedIds.add(node.id);
    const guaranteedInactive = scored
      .filter(({ node }) => (
        (node.status ?? "active") !== "active" && !guaranteedIds.has(node.id)
      ))
      .slice(0, maxInactiveNodes);
    for (const { node } of guaranteedInactive) guaranteedIds.add(node.id);
    const ranked = [
      ...guaranteedRelations,
      ...guaranteedCommitments,
      ...guaranteedInactive,
      ...scored.filter(({ node }) => !guaranteedIds.has(node.id)),
    ];

    const entries: ActorMemoryRecall[] = [];
    let estimatedTokens = 0;
    for (const entry of ranked) {
      if (entries.length >= maxNodes) break;
      const remaining = maxTokens - estimatedTokens;
      if (remaining < 16) break;
      const node = fitNodeToBudget(entry.node, remaining);
      const cost = estimateNodeTokens(node);
      if (cost <= 0) continue;
      entries.push({ node, score: entry.score });
      estimatedTokens += cost;
      const stored = space.nodes.get(entry.node.id);
      if (stored) stored.lastRecalledAt = this.runtime.clock.now();
    }

    return { actorId: query.actorId, entries, estimatedTokens };
  }

  record(actorId: string, candidate: ActorMemoryCandidate): ActorMemoryNode {
    const space = this.requireSpace(actorId);
    const node = this.recordInto(space, candidate);
    const now = this.runtime.clock.now();
    touch(space, now);
    syncDocuments(space);
    return cloneNode(node);
  }

  revise(actorId: string, revision: ActorMemoryRevision): ActorMemoryNode {
    const space = this.requireSpace(actorId);
    const next = this.reviseInto(space, revision);
    const now = this.runtime.clock.now();
    touch(space, now);
    syncDocuments(space);
    return cloneNode(next);
  }

  applyTransaction(
    actorId: string,
    patch: ActorMemoryPatch,
    expectedRevision?: number,
  ): ActorMemoryCommit {
    const current = this.requireSpace(actorId);
    const idempotencyKey = requireText(patch.idempotencyKey, "Actor memory patch idempotency key");
    if (current.appliedPatchIds.has(idempotencyKey)) {
      return {
        actorId,
        idempotencyKey,
        applied: false,
        fromRevision: current.revision,
        toRevision: current.revision,
        createdNodeIds: [],
        revisedNodeIds: [],
        deletedNodeIds: [],
        createdEdgeIds: [],
        deletedEdgeIds: [],
      };
    }
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new Error(
        `Actor memory revision conflict for ${actorId}: expected ${expectedRevision}, got ${current.revision}`,
      );
    }

    // Work against a clone so one invalid operation cannot partially mutate memory.
    const working = cloneSpace(current);
    const createdNodeIds: string[] = [];
    const revisedNodeIds: string[] = [];
    const deletedNodeIds: string[] = [];
    const createdEdgeIds: string[] = [];
    const deletedEdgeIds: string[] = [];
    const allowedSourceIds = new Set(normalizeStrings(patch.sourceEventIds) ?? []);
    for (const operation of patch.operations) {
      if (operation.type === "create") {
        assertSourcesAllowed(operation.candidate.sourceEventIds, allowedSourceIds);
        const beforeEdges = new Set(working.edges.keys());
        const node = this.recordInto(working, operation.candidate);
        createdNodeIds.push(node.id);
        for (const edgeId of working.edges.keys()) {
          if (!beforeEdges.has(edgeId)) createdEdgeIds.push(edgeId);
        }
      } else if (operation.type === "revise") {
        assertSourcesAllowed(operation.revision.sourceEventIds, allowedSourceIds);
        const existing = working.nodes.get(operation.revision.nodeId);
        const node = this.reviseInto(working, {
          ...operation.revision,
          // Automatic curation adds evidence; it must not erase older provenance.
          sourceEventIds: mergeNormalizedStrings(
            existing?.sourceEventIds,
            operation.revision.sourceEventIds,
          ),
        });
        revisedNodeIds.push(node.id);
      } else if (operation.type === "delete") {
        assertSourcesAllowed(operation.deletion.sourceEventIds, allowedSourceIds);
        if (!working.nodes.delete(operation.deletion.nodeId)) {
          throw new Error(`Unknown actor memory node: ${operation.deletion.nodeId}`);
        }
        deletedNodeIds.push(operation.deletion.nodeId);
        for (const [edgeId, edge] of [...working.edges]) {
          if (
            edge.fromNodeId === operation.deletion.nodeId ||
            edge.toId === operation.deletion.nodeId
          ) {
            working.edges.delete(edgeId);
            deletedEdgeIds.push(edgeId);
          }
        }
      } else {
        const edge = this.linkInto(working, operation.link);
        createdEdgeIds.push(edge.id);
      }
    }

    const fromRevision = current.revision;
    const now = this.runtime.clock.now();
    working.appliedPatchIds.add(idempotencyKey);
    trimSet(working.appliedPatchIds, 128);
    touch(working, now);
    syncDocuments(working);
    this.spaces.set(actorId, working);
    return {
      actorId,
      idempotencyKey,
      applied: true,
      fromRevision,
      toRevision: working.revision,
      createdNodeIds,
      revisedNodeIds,
      deletedNodeIds,
      createdEdgeIds,
      deletedEdgeIds,
    };
  }

  snapshot(actorId: string): ActorMemorySnapshot {
    const space = this.requireSpace(actorId);
    return {
      schemaVersion: 1,
      actorId,
      revision: space.revision,
      documents: [...space.documents.values()].map(cloneDocument),
      nodes: [...space.nodes.values()].map(cloneNode),
      edges: [...space.edges.values()].map(cloneEdge),
      appliedPatchIds: [...space.appliedPatchIds],
      updatedAt: space.updatedAt,
    };
  }

  snapshots(): ActorMemorySnapshot[] {
    return [...this.spaces.keys()].map((actorId) => this.snapshot(actorId));
  }

  private score(
    space: ActorMemorySpace,
    node: ActorMemoryNode,
    terms: readonly string[],
    related: ReadonlySet<string>,
  ): number {
    let score = normalizeWeight(node.importance, 0.5) * 1.5;
    if ((node.status ?? "active") !== "active") score *= 0.35;
    if (node.kind === "self") score += 0.4;
    if (node.kind === "commitment") score += 0.6;
    const haystack = `${node.semanticKey ?? ""}\n${node.title}\n${node.content}\n${(node.tags ?? []).join(" ")}`.toLocaleLowerCase();
    for (const term of terms) {
      if (haystack.includes(term)) score += 1.3;
    }
    for (const edge of space.edges.values()) {
      if (edge.fromNodeId !== node.id) continue;
      if (related.has(edge.toId)) score += 2.5 * normalizeWeight(edge.weight, 0.5);
    }
    return score;
  }

  private targetsAny(
    space: ActorMemorySpace,
    nodeId: string,
    targets: ReadonlySet<string>,
  ): boolean {
    if (targets.size === 0) return false;
    for (const edge of space.edges.values()) {
      if (edge.fromNodeId === nodeId && targets.has(edge.toId)) return true;
    }
    return false;
  }

  private requireSpace(actorId: string): ActorMemorySpace {
    const space = this.spaces.get(actorId);
    if (!space) throw new Error(`Unknown actor memory workspace: ${actorId}`);
    return space;
  }

  private recordInto(
    space: ActorMemorySpace,
    candidate: ActorMemoryCandidate,
  ): ActorMemoryNode {
    const now = this.runtime.clock.now();
    const semanticKey = requireText(candidate.semanticKey ?? "", "Actor memory semantic key");
    const duplicate = [...space.nodes.values()].find((node) => (
      (node.status ?? "active") === "active" && node.semanticKey === semanticKey
    ));
    if (duplicate) {
      throw new Error(`Active actor memory semantic key already exists: ${semanticKey}`);
    }
    const node: ActorMemoryNode = {
      id: `memory:${space.actorId}:${this.runtime.idGenerator.next()}`,
      kind: candidate.kind,
      semanticKey,
      title: requireText(candidate.title, "Actor memory title"),
      content: requireText(candidate.content, "Actor memory content"),
      status: "active",
      importance: normalizeWeight(candidate.importance, 0.5),
      confidence: normalizeWeight(candidate.confidence, 1),
      tags: normalizeStrings(candidate.tags),
      sourceEventIds: normalizeStrings(candidate.sourceEventIds),
      createdAt: now,
      updatedAt: now,
    };
    space.nodes.set(node.id, node);
    for (const link of normalizedCandidateLinks(candidate)) {
      this.linkInto(space, {
        fromNodeId: node.id,
        ...link,
      });
    }
    return node;
  }

  private reviseInto(
    space: ActorMemorySpace,
    revision: ActorMemoryRevision,
  ): ActorMemoryNode {
    const existing = space.nodes.get(revision.nodeId);
    if (!existing) throw new Error(`Unknown actor memory node: ${revision.nodeId}`);
    const semanticKey = revision.semanticKey === undefined
      ? existing.semanticKey
      : requireText(revision.semanticKey, "Actor memory semantic key");
    const nextStatus = revision.status ?? existing.status ?? "active";
    if (semanticKey && nextStatus === "active") {
      const duplicate = [...space.nodes.values()].find((node) => (
        node.id !== existing.id &&
        (node.status ?? "active") === "active" &&
        node.semanticKey === semanticKey
      ));
      if (duplicate) {
        throw new Error(`Active actor memory semantic key already exists: ${semanticKey}`);
      }
    }
    const next: ActorMemoryNode = {
      ...existing,
      semanticKey,
      title: revision.title === undefined
        ? existing.title
        : requireText(revision.title, "Actor memory title"),
      content: revision.content === undefined
        ? existing.content
        : requireText(revision.content, "Actor memory content"),
      status: revision.status ?? existing.status,
      importance: revision.importance === undefined
        ? existing.importance
        : normalizeWeight(revision.importance, 0.5),
      confidence: revision.confidence === undefined
        ? existing.confidence
        : normalizeWeight(revision.confidence, 1),
      tags: revision.tags === undefined ? existing.tags : normalizeStrings(revision.tags),
      sourceEventIds: revision.sourceEventIds === undefined
        ? existing.sourceEventIds
        : normalizeStrings(revision.sourceEventIds),
      updatedAt: this.runtime.clock.now(),
    };
    space.nodes.set(next.id, next);
    ensureRelationTargetEdge(space, next, this.runtime.clock.now());
    return next;
  }

  private linkInto(
    space: ActorMemorySpace,
    link: ActorMemoryLinkCandidate,
  ): ActorMemoryEdge {
    if (!space.nodes.has(link.fromNodeId)) {
      throw new Error(`Unknown actor memory node: ${link.fromNodeId}`);
    }
    const now = this.runtime.clock.now();
    const edge: ActorMemoryEdge = {
      id: `memory-edge:${space.actorId}:${this.runtime.idGenerator.next()}`,
      fromNodeId: link.fromNodeId,
      toId: requireText(link.toId, "Actor memory link target"),
      type: link.type,
      weight: normalizeWeight(link.weight, 0.5),
      description: link.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    space.edges.set(edge.id, edge);
    return edge;
  }
}

function createSpace(seed: ActorMemorySpaceSeed, now: number): ActorMemorySpace {
  const snapshot = seed.snapshot;
  const documents = snapshot?.documents ?? seed.definition?.documents ?? [];
  const parsed = parseDocuments(documents, now);
  const nodes = parsed.nodes.length > 0
    ? parsed.nodes
    : snapshot?.nodes ?? seed.definition?.nodes ?? [];
  const edges = parsed.nodes.length > 0
    ? parsed.edges
    : snapshot?.edges ?? seed.definition?.edges ?? [];
  const space: ActorMemorySpace = {
    actorId: seed.actorId,
    revision: snapshot?.revision ?? 0,
    updatedAt: snapshot?.updatedAt ?? now,
    nodes: new Map(),
    edges: new Map(),
    documents: new Map(),
    appliedPatchIds: new Set(snapshot?.appliedPatchIds ?? []),
  };
  for (const node of nodes) {
    space.nodes.set(node.id, normalizeNode(node, now));
  }
  for (const edge of edges) {
    if (!space.nodes.has(edge.fromNodeId)) continue;
    space.edges.set(edge.id, normalizeEdge(edge, now));
  }
  for (const node of space.nodes.values()) ensureRelationTargetEdge(space, node, now);
  syncDocuments(space);
  return space;
}

function cloneSpace(space: ActorMemorySpace): ActorMemorySpace {
  return {
    actorId: space.actorId,
    revision: space.revision,
    updatedAt: space.updatedAt,
    nodes: new Map([...space.nodes].map(([id, node]) => [id, cloneNode(node)])),
    edges: new Map([...space.edges].map(([id, edge]) => [id, cloneEdge(edge)])),
    documents: new Map([...space.documents].map(([id, document]) => [id, cloneDocument(document)])),
    appliedPatchIds: new Set(space.appliedPatchIds),
  };
}

interface MarkdownMemoryMetadata {
  id: string;
  kind: ActorMemoryNode["kind"];
  semanticKey?: string;
  status?: ActorMemoryNode["status"];
  importance?: number;
  confidence?: number;
  tags?: string[];
  sourceEventIds?: string[];
  createdAt?: number;
  updatedAt?: number;
  links?: ActorMemoryEdge[];
}

const MEMORY_DOCUMENT_PREFIX = "<!-- chatverse-memory\n";
const MEMORY_DOCUMENT_SEPARATOR = "\n-->\n\n";

function syncDocuments(space: ActorMemorySpace): void {
  const documents = new Map<string, ActorMemoryDocument>();
  for (const node of space.nodes.values()) {
    const links = [...space.edges.values()]
      .filter((edge) => edge.fromNodeId === node.id)
      .map(cloneEdge);
    const metadata: MarkdownMemoryMetadata = {
      id: node.id,
      kind: node.kind,
      semanticKey: node.semanticKey,
      status: node.status,
      importance: node.importance,
      confidence: node.confidence,
      tags: node.tags ? [...node.tags] : undefined,
      sourceEventIds: node.sourceEventIds ? [...node.sourceEventIds] : undefined,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      links,
    };
    documents.set(node.id, {
      id: node.id,
      path: memoryDocumentPath(node),
      markdown: `${MEMORY_DOCUMENT_PREFIX}${JSON.stringify(metadata)}${MEMORY_DOCUMENT_SEPARATOR}# ${node.title.replace(/[\r\n]+/g, " ")}\n\n${node.content}\n`,
    });
  }
  space.documents = documents;
}

function parseDocuments(
  documents: readonly ActorMemoryDocument[],
  now: number,
): { nodes: ActorMemoryNode[]; edges: ActorMemoryEdge[] } {
  const nodes: ActorMemoryNode[] = [];
  const edges: ActorMemoryEdge[] = [];
  for (const document of documents) {
    if (!document.markdown.startsWith(MEMORY_DOCUMENT_PREFIX)) continue;
    const separatorAt = document.markdown.indexOf(MEMORY_DOCUMENT_SEPARATOR);
    if (separatorAt < 0) continue;
    try {
      const metadata = JSON.parse(
        document.markdown.slice(MEMORY_DOCUMENT_PREFIX.length, separatorAt),
      ) as MarkdownMemoryMetadata;
      const body = document.markdown.slice(separatorAt + MEMORY_DOCUMENT_SEPARATOR.length);
      const headingEnd = body.indexOf("\n");
      if (!body.startsWith("# ") || headingEnd < 3) continue;
      const title = body.slice(2, headingEnd).trim();
      const content = body.slice(headingEnd).trim();
      const node = normalizeNode({
        id: metadata.id || document.id,
        kind: metadata.kind,
        semanticKey: metadata.semanticKey,
        title,
        content,
        status: metadata.status,
        importance: metadata.importance,
        confidence: metadata.confidence,
        tags: metadata.tags,
        sourceEventIds: metadata.sourceEventIds,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      }, now);
      nodes.push(node);
      for (const edge of metadata.links ?? []) {
        if (edge.fromNodeId !== node.id) continue;
        edges.push(normalizeEdge(edge, now));
      }
    } catch {
      continue;
    }
  }
  return { nodes, edges };
}

function memoryDocumentPath(node: ActorMemoryNode): string {
  const folder = node.kind === "relation"
    ? "relations"
    : node.kind === "commitment"
      ? "commitments"
      : "notes";
  const identity = node.semanticKey || node.id;
  const slug = identity
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "memory";
  return `memories/${folder}/${slug}-${stablePathHash(identity)}.md`;
}

function stablePathHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function normalizedCandidateLinks(
  candidate: ActorMemoryCandidate,
): NonNullable<ActorMemoryCandidate["links"]> {
  const links = [...(candidate.links ?? [])];
  if (candidate.kind !== "relation" || !candidate.semanticKey.startsWith("relation:")) {
    return links;
  }
  const actorId = candidate.semanticKey.slice("relation:".length).trim();
  const target = actorId ? `actor:${actorId}` : "";
  if (target && !links.some((link) => link.toId === target)) {
    links.push({
      toId: target,
      type: "believes",
      weight: 1,
      description: "Current directed relationship",
    });
  }
  return links;
}

function ensureRelationTargetEdge(
  space: ActorMemorySpace,
  node: ActorMemoryNode,
  now: number,
): void {
  if (node.kind !== "relation" || !node.semanticKey?.startsWith("relation:")) return;
  const actorId = node.semanticKey.slice("relation:".length).trim();
  const target = actorId ? `actor:${actorId}` : "";
  if (!target || [...space.edges.values()].some((edge) => (
    edge.fromNodeId === node.id && edge.toId === target
  ))) return;
  const edge: ActorMemoryEdge = {
    id: `memory-edge:${space.actorId}:${stablePathHash(`${node.id}:${target}`)}`,
    fromNodeId: node.id,
    toId: target,
    type: "believes",
    weight: 1,
    description: "Current directed relationship",
    createdAt: now,
    updatedAt: now,
  };
  space.edges.set(edge.id, edge);
}

function normalizeNode(node: ActorMemoryNode, now: number): ActorMemoryNode {
  return {
    ...node,
    semanticKey: node.semanticKey?.trim() || undefined,
    title: requireText(node.title, "Actor memory title"),
    content: requireText(node.content, "Actor memory content"),
    status: node.status ?? "active",
    importance: normalizeWeight(node.importance, 0.5),
    confidence: normalizeWeight(node.confidence, 1),
    tags: normalizeStrings(node.tags),
    sourceEventIds: normalizeStrings(node.sourceEventIds),
    createdAt: node.createdAt ?? now,
    updatedAt: node.updatedAt ?? now,
    lastRecalledAt: node.lastRecalledAt,
  };
}

function normalizeEdge(edge: ActorMemoryEdge, now: number): ActorMemoryEdge {
  return {
    ...edge,
    weight: normalizeWeight(edge.weight, 0.5),
    description: edge.description?.trim() || undefined,
    createdAt: edge.createdAt ?? now,
    updatedAt: edge.updatedAt ?? now,
  };
}

function fitNodeToBudget(node: ActorMemoryNode, maxTokens: number): ActorMemoryNode {
  if (estimateNodeTokens(node) <= maxTokens) return cloneNode(node);
  const titleCost = estimateTextTokens(node.title) + 4;
  const availableCharacters = Math.max(12, (maxTokens - titleCost) * 3);
  const content = node.content.length > availableCharacters
    ? `${node.content.slice(0, Math.max(0, availableCharacters - 3))}...`
    : node.content;
  return { ...cloneNode(node), content };
}

function estimateNodeTokens(node: ActorMemoryNode): number {
  return estimateTextTokens(`${node.title}\n${node.content}`) + 6;
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

function extractTerms(text: string): string[] {
  const latin = text.toLocaleLowerCase().match(/[a-z0-9_-]{2,}/g) ?? [];
  const cjkRuns = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const cjk = cjkRuns.flatMap((run) => {
    const terms = [run.slice(0, 12)];
    for (let index = 0; index < run.length - 1; index++) {
      terms.push(run.slice(index, index + 2));
    }
    return terms;
  });
  return [...new Set([...latin, ...cjk])];
}

function normalizeWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeStrings(values: readonly string[] | undefined): string[] | undefined {
  const normalized = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  return normalized.length ? normalized : undefined;
}

function mergeNormalizedStrings(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined,
): string[] | undefined {
  return normalizeStrings([...(first ?? []), ...(second ?? [])]);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

function assertSourcesAllowed(
  sourceEventIds: readonly string[] | undefined,
  allowedSourceIds: ReadonlySet<string>,
): void {
  for (const sourceEventId of sourceEventIds ?? []) {
    if (!allowedSourceIds.has(sourceEventId)) {
      throw new Error(`Actor memory operation references an unobserved event: ${sourceEventId}`);
    }
  }
}

function touch(space: ActorMemorySpace, now: number): void {
  space.revision += 1;
  space.updatedAt = now;
}

function trimSet(values: Set<string>, maxSize: number): void {
  while (values.size > maxSize) {
    const oldest = values.values().next().value as string | undefined;
    if (oldest === undefined) return;
    values.delete(oldest);
  }
}

function cloneNode(node: ActorMemoryNode): ActorMemoryNode {
  return {
    ...node,
    tags: node.tags ? [...node.tags] : undefined,
    sourceEventIds: node.sourceEventIds ? [...node.sourceEventIds] : undefined,
  };
}

function cloneDocument(document: ActorMemoryDocument): ActorMemoryDocument {
  return { ...document };
}

function cloneEdge(edge: ActorMemoryEdge): ActorMemoryEdge {
  return { ...edge };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
