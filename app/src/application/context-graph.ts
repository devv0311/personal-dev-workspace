// Use case: the Context Graph read model (P3.2).
//
// This is the ONE source the interactive graph reads. It is assembled from the
// same repositories, under the same ResolvedScope, through the same
// VisibilityPolicy fragment as every other read (INV-3). There is deliberately
// no graph-specific authorization path that could drift from the policy:
//   • nodes  = objects the scope may see (ObjectRepository.listVisible)
//   • edges  = edges the scope may see (RelationshipRepository.listVisible)
// A final assembly-time cross-check drops any edge whose endpoints are not both
// in the visible node set, so an edge can never imply the existence of a node
// the principal cannot see (P2.6 §15.5 post-hoc check on derived data).
//
// Semantic layers (Design blueprint §12.1) are a PRESENTATION mapping over the
// real object type — no domain semantics are invented:
//   core    → the workspace itself (the root context)
//   context → project, task            (developer context)
//   memory  → note, idea, decision, resource, checkpoint  (stored context)
// Structural containment (object.workspace_id, and object.home_project_id for
// an Inbox object) is surfaced as an edge with origin 'structural' — the
// category P2.6 §8.3 reserves for edges computed on read, never stored.

import type {
  ObjectRepository,
  RelationshipRepository,
} from '../ports/repositories.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import type { ObjectType, WorkspaceObject } from '../domain/objects.ts';
import type {
  ConfidenceState,
  Provenance,
  RelationshipEdge,
  RelationshipOrigin,
  RelationshipVerb,
  VisibilityScope,
} from '../domain/relationships.ts';
import { asObjectId, asProjectId } from '../domain/ids.ts';
import { notFound } from '../domain/errors.ts';

export interface ContextGraphDeps {
  objects: ObjectRepository;
  relationships: RelationshipRepository;
}

export type GraphLayer = 'core' | 'context' | 'memory';
export type GraphNodeKind = 'workspace' | 'object';

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  /** The real object type, or 'workspace' for the root node. */
  readonly type: ObjectType | 'workspace';
  readonly layer: GraphLayer;
  readonly title: string;
  readonly snippet: string;
  readonly homeProjectId: string | null;
  readonly ownerId: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface GraphEdge {
  /** Stable client key. Persisted rows use their row id; derived edges a tag. */
  readonly id: string;
  readonly relationshipId: string | null;
  readonly from: string;
  readonly to: string;
  readonly verb: RelationshipVerb;
  readonly origin: RelationshipOrigin;
  readonly confidenceState: ConfidenceState;
  readonly visibilityScope: VisibilityScope;
  readonly authorId: string | null;
  readonly provenance: Provenance;
  readonly synthesised: boolean;
  readonly createdAt: string;
}

export interface ContextGraph {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly stats: {
    readonly nodes: number;
    readonly edges: number;
    readonly projects: number;
    readonly captures: number;
    readonly byType: Readonly<Record<string, number>>;
  };
}

const LAYER_BY_TYPE: Record<ObjectType, GraphLayer> = {
  project: 'context',
  task: 'context',
  note: 'memory',
  idea: 'memory',
  decision: 'memory',
  resource: 'memory',
  checkpoint: 'memory',
};

const SNIPPET_MAX = 180;
/**
 * The graph root is the user's own Workspace — a real entity in the data model
 * (blueprint §5.5). It is named in PRODUCT vocabulary and must never be named
 * after the assistant or its configuration.
 */
const ROOT_TITLE = 'Workspace';

/**
 * Weak / possible relationships are excluded from the primary context view
 * (P2.2 §4, restated as a hard rendering rule at blueprint §5.3). They are
 * reachable only through a deliberate on-demand "possibly related" affordance,
 * which is not built (blueprint Q6 — deferred).
 *
 * The filter lives HERE, in the read model, rather than in the client: a view
 * filter can be bypassed, and every consumer of this graph — the field, the
 * inspector, the rails — must get the same answer. Only the RELATIONSHIP is
 * withheld; the object at its far end is a real visible object and continues
 * to be returned as a node on its own merits.
 */
const isWeak = (e: RelationshipEdge): boolean => e.confidenceState === 'weak';

function snippet(o: WorkspaceObject): string {
  const source = o.body || '';
  const flat = source.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1)}…` : flat;
}

function toNode(o: WorkspaceObject): GraphNode {
  return {
    id: o.id,
    kind: 'object',
    type: o.type,
    layer: LAYER_BY_TYPE[o.type] ?? 'memory',
    title: o.title,
    snippet: snippet(o),
    homeProjectId: o.homeProjectId,
    ownerId: o.ownerId,
    createdBy: o.createdBy,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function toEdge(e: RelationshipEdge): GraphEdge {
  return {
    id: e.id ?? `derived:${e.verb}:${e.fromObjectId}>${e.toObjectId}`,
    relationshipId: e.id,
    from: e.fromObjectId,
    to: e.toObjectId,
    verb: e.verb,
    origin: e.origin,
    confidenceState: e.confidenceState,
    visibilityScope: e.visibilityScope,
    authorId: e.authorId,
    provenance: e.provenance,
    synthesised: e.synthesised,
    createdAt: e.createdAt,
  };
}

/**
 * Structural containment edge, computed on read (P2.6 §8.3). It restates a real
 * column — object.workspace_id — and is labelled 'structural' so no consumer can
 * mistake it for an authored relationship.
 */
function containmentEdge(objectId: string, workspaceId: string, at: string): GraphEdge {
  return {
    id: `structural:workspace:${objectId}`,
    relationshipId: null,
    from: objectId,
    to: workspaceId,
    verb: 'belongs_to',
    origin: 'structural',
    confidenceState: 'known',
    visibilityScope: 'shared',
    authorId: null,
    provenance: { kind: 'structural:workspace', detail: { column: 'object.workspace_id' } },
    synthesised: true,
    createdAt: at,
  };
}

export async function buildContextGraph(
  deps: ContextGraphDeps,
  scope: ResolvedScope,
): Promise<ContextGraph> {
  const objects = await deps.objects.listVisible(scope);
  const rawEdges = await deps.relationships.listVisible(scope);

  const nodes: GraphNode[] = objects.map(toNode);
  const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  // The root context node. Its id is the real workspace id from the resolved
  // scope — the principal is a member of it by construction (ScopeResolver).
  const rootAt = objects[0]?.createdAt ?? new Date(0).toISOString();
  const root: GraphNode = {
    id: scope.workspaceId,
    kind: 'workspace',
    type: 'workspace',
    layer: 'core',
    title: ROOT_TITLE,
    snippet: 'Workspace root context',
    homeProjectId: null,
    ownerId: null,
    createdBy: null,
    createdAt: rootAt,
    updatedAt: rootAt,
  };
  byId.set(root.id, root);

  const edges: GraphEdge[] = [];
  for (const e of rawEdges) {
    // Weak links never enter the primary context view (P2.2 §4).
    if (isWeak(e)) continue;
    // Post-hoc cross-check: both endpoints must be in the visible node set.
    if (byId.has(e.fromObjectId) && byId.has(e.toObjectId)) edges.push(toEdge(e));
  }

  // Structural containment: top-level objects (a Project, or any object with no
  // home project — the Inbox case) hang off the root context.
  for (const o of objects) {
    if (o.homeProjectId === null) {
      edges.push(containmentEdge(o.id, root.id, o.createdAt));
    }
  }

  const byType: Record<string, number> = {};
  for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;

  return {
    workspaceId: scope.workspaceId,
    principalId: scope.principalId,
    nodes: [root, ...nodes],
    edges,
    stats: {
      nodes: nodes.length + 1,
      edges: edges.length,
      projects: byType['project'] ?? 0,
      captures: nodes.filter((n) => n.layer === 'memory').length,
      byType,
    },
  };
}

// --- single-object inspection (the Context Inspector's data source) ---------

export interface InspectedEdge {
  readonly edge: GraphEdge;
  readonly direction: 'out' | 'in';
  /** The object at the other end, resolved through the same visibility check. */
  readonly other: { id: string; type: string; title: string } | null;
}

export interface ObjectInspection {
  readonly object: WorkspaceObject;
  readonly edges: readonly InspectedEdge[];
  /** For a Project: the context captured into it. Empty for other types. */
  readonly children: readonly WorkspaceObject[];
}

export async function inspectObject(
  deps: ContextGraphDeps,
  scope: ResolvedScope,
  objectIdRaw: string,
): Promise<ObjectInspection> {
  const object = await deps.objects.findVisible(scope, asObjectId(objectIdRaw));
  // Deny-by-default: invisible and absent are indistinguishable.
  if (!object) throw notFound('Object not found.');

  const raw = await deps.relationships.forObject(scope, object.id);
  const edges: InspectedEdge[] = [];
  for (const e of raw) {
    // Same rule as the whole-graph read: the inspector is primary context too,
    // so a weak link must not surface here either (P2.2 §4).
    if (isWeak(e)) continue;
    const outgoing = e.fromObjectId === object.id;
    const otherId = outgoing ? e.toObjectId : e.fromObjectId;
    // Resolve the far endpoint through findVisible — never from a join the
    // policy did not filter.
    const other = await deps.objects.findVisible(scope, otherId);
    edges.push({
      edge: toEdge(e),
      direction: outgoing ? 'out' : 'in',
      other: other ? { id: other.id, type: other.type, title: other.title } : null,
    });
  }

  // The same structural containment edge the graph draws, so the inspector and
  // the graph never disagree about one object's edges.
  if (object.homeProjectId === null) {
    edges.push({
      edge: containmentEdge(object.id, scope.workspaceId, object.createdAt),
      direction: 'out',
      other: { id: scope.workspaceId, type: 'workspace', title: ROOT_TITLE },
    });
  }

  const children =
    object.type === 'project'
      ? await deps.objects.listByHomeProject(scope, asProjectId(object.id))
      : [];

  return { object, edges, children };
}
