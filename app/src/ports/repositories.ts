// Port interfaces (P2.6 §6). No SQL, no driver types here.
// Every read takes a ResolvedScope — there is no unprincipled overload (INV-3).

import type { ObjectId, PrincipalId, ProjectId, WorkspaceId } from '../domain/ids.ts';
import type { WorkspaceObject, ObjectType } from '../domain/objects.ts';
import type { RelationshipEdge } from '../domain/relationships.ts';
import type { ResolvedScope } from '../domain/visibility.ts';

export interface Tx {
  query<R = unknown>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

export interface UnitOfWork {
  /** Runs `fn` inside a single database transaction (P2.6 §12.4 atomic set). */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  query<R = unknown>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

export interface ScopeResolver {
  /** Resolve the per-request scope snapshot once (P2.6 §9.2). */
  resolve(principalId: PrincipalId): Promise<ResolvedScope | null>;
}

export interface NewObject {
  readonly workspaceId: WorkspaceId;
  readonly type: ObjectType;
  readonly title: string;
  readonly body: string;
  readonly attributes: Record<string, unknown>;
  readonly homeProjectId: ProjectId | null;
  readonly ownerId: PrincipalId;
  readonly createdBy: PrincipalId;
}

export interface ObjectRepository {
  /** Visible object by id, or null. Filter-first. */
  findVisible(scope: ResolvedScope, id: ObjectId): Promise<WorkspaceObject | null>;
  /**
   * Every object in the scope's workspace the scope may see, oldest first.
   * Filter-first — the same VisibilityPolicy fragment as every other read.
   * `limit` bounds the read model for the graph (P3.2); it is a resource bound,
   * never an authorization bound.
   */
  listVisible(scope: ResolvedScope, limit?: number): Promise<WorkspaceObject[]>;
  /** Visible objects whose home project is `projectId`, oldest first. Filter-first. */
  listByHomeProject(
    scope: ResolvedScope,
    projectId: ProjectId,
  ): Promise<WorkspaceObject[]>;
  /** Visible projects in the scope's workspace. */
  listProjects(scope: ResolvedScope): Promise<WorkspaceObject[]>;
  /** Insert inside a transaction. */
  create(tx: Tx, input: NewObject): Promise<WorkspaceObject>;
}

export interface RelationshipRepository {
  /**
   * Edges touching `objectId` that the scope may see. Real `relationship` rows
   * (filter-first) UNION the synthesised `belongs_to` edge from home_project_id
   * — so no consumer special-cases the FK (INV-2, P2.6 §8.2).
   */
  forObject(scope: ResolvedScope, objectId: ObjectId): Promise<RelationshipEdge[]>;
  /**
   * Every edge in the scope's workspace the scope may see — the whole-graph form
   * of forObject(). Same composition: real rows filter-first through
   * relationshipSqlFragment, UNION the synthesised belongs_to edges, which are
   * emitted only when BOTH endpoints are visible (INV-3).
   */
  listVisible(scope: ResolvedScope, limit?: number): Promise<RelationshipEdge[]>;
  create(
    tx: Tx,
    edge: Omit<RelationshipEdge, 'id' | 'createdAt' | 'synthesised'>,
  ): Promise<RelationshipEdge>;
}

export interface OutboxWriter {
  /** Append an event in the caller's transaction (INV-13). Payload = ids + kind only. */
  append(
    tx: Tx,
    event: { workspaceId: WorkspaceId; type: string; payload: Record<string, unknown> },
  ): Promise<void>;
}

export interface ActivityWriter {
  append(
    tx: Tx,
    entry: {
      objectId: ObjectId;
      workspaceId: WorkspaceId;
      kind: string;
      actorId: PrincipalId;
      detail: Record<string, unknown>;
    },
  ): Promise<void>;
}

export interface AuditWriter {
  append(
    tx: Tx,
    entry: {
      workspaceId: WorkspaceId;
      actorId: PrincipalId;
      action: string;
      supportingRefs: unknown[];
    },
  ): Promise<void>;
}

/**
 * Workspace membership, read-only (T3.2).
 *
 * The people surface shows exactly what the model records about a person —
 * their workspace membership and the display name on their principal row —
 * and nothing else. There is no e-mail, no avatar, no role, no external
 * account and no per-person activity in the schema, so none is returned here
 * and none can be rendered downstream.
 */
export interface MemberRepository {
  /** Principals who are members of the caller's own workspace. */
  listMembers(scope: ResolvedScope): Promise<WorkspaceMember[]>;
}

export interface WorkspaceMember {
  readonly id: string;
  readonly displayName: string;
}
