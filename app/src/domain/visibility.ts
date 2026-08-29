// The single VisibilityPolicy (P2.6 §9.2, INV-3).
//
// One rule source, two interpreters:
//   • toSql(...)   — a predicate fragment composed into every persistence read
//                    (the filter-first path).
//   • evaluate(...) — a pure boolean over an already-fetched row, for post-hoc
//                    checks on retrieval hits and derived data (P2.6 §15.5).
//
// Both are produced from the same declarative `Node` tree, so they cannot drift.
// A cross-check test (test/visibility.test.ts) asserts they agree.
//
// Rule (P2.6 §9.2, with one implementation refinement — see below):
//   visible(object, s) ⟺ object.workspace_id = s.workspaceId
//                        ∧ ( object.owner_id = s.principalId
//                            ∨ object.home_project_id ∈ s.sharedProjectIds
//                            ∨ object.id ∈ s.sharedProjectIds )
//   visible(rel, s)    ⟺ visible(from(rel), s) ∧ visible(to(rel), s)
//                        ∧ ( rel.visibility_scope = 'shared' ∨ rel.author_id = s.principalId )
//
// REFINEMENT (P2.7 §16): P2.6 §9.2's shorthand predicate checks only
// `home_project_id ∈ sharedProjectIds`. A shared Project's own record has a
// NULL home_project_id, so that clause alone would hide the shared project
// container from the very teammate it was shared with — contradicting P2.1 §4
// ("share a Project → its objects become visible"). The `object.id ∈
// sharedProjectIds` disjunct makes the shared project itself visible. For a
// note, `id` is never a project id, so the clause is inert. This refines, and
// does not reopen, the accepted predicate.

import type { PrincipalId, ProjectId, WorkspaceId } from './ids.ts';

export interface ResolvedScope {
  readonly workspaceId: WorkspaceId;
  readonly principalId: PrincipalId;
  readonly sharedProjectIds: readonly ProjectId[];
}

// --- declarative predicate algebra -----------------------------------------

type FieldName =
  | 'id'
  | 'workspace_id'
  | 'owner_id'
  | 'home_project_id'
  | 'visibility_scope'
  | 'author_id';

type Node =
  | { readonly op: 'eq'; readonly field: FieldName; readonly value: string }
  | { readonly op: 'in'; readonly field: FieldName; readonly values: readonly string[] }
  | { readonly op: 'and'; readonly nodes: readonly Node[] }
  | { readonly op: 'or'; readonly nodes: readonly Node[] }
  | { readonly op: 'false' };

const eq = (field: FieldName, value: string): Node => ({ op: 'eq', field, value });
const inList = (field: FieldName, values: readonly string[]): Node =>
  values.length === 0 ? { op: 'false' } : { op: 'in', field, values };
const and = (...nodes: Node[]): Node => ({ op: 'and', nodes });
const or = (...nodes: Node[]): Node => ({ op: 'or', nodes });

// --- the rule (single source) --------------------------------------------------

function objectRule(scope: ResolvedScope): Node {
  return and(
    eq('workspace_id', scope.workspaceId),
    or(
      eq('owner_id', scope.principalId),
      inList('home_project_id', scope.sharedProjectIds),
      inList('id', scope.sharedProjectIds), // the shared project container itself
    ),
  );
}

function relationshipEdgeRule(scope: ResolvedScope): Node {
  // Endpoint visibility is applied separately (SQL: joins; JS: canSeeObject).
  return or(eq('visibility_scope', 'shared'), eq('author_id', scope.principalId));
}

// --- SQL interpreter ---------------------------------------------------------

export interface SqlFragment {
  readonly text: string;
  readonly params: readonly unknown[];
}

class ParamSink {
  readonly params: unknown[] = [];
  #nextIndex: number;
  constructor(startIndex: number) {
    this.#nextIndex = startIndex;
  }
  add(value: unknown): string {
    this.params.push(value);
    return `$${this.#nextIndex++}`;
  }
}

function nodeToSql(node: Node, alias: string, sink: ParamSink): string {
  switch (node.op) {
    case 'false':
      return 'FALSE';
    case 'eq':
      return `${alias}.${node.field} = ${sink.add(node.value)}`;
    case 'in': {
      const placeholders = node.values.map((v) => sink.add(v)).join(', ');
      return `${alias}.${node.field} IN (${placeholders})`;
    }
    case 'and':
      return `(${node.nodes.map((n) => nodeToSql(n, alias, sink)).join(' AND ')})`;
    case 'or':
      return `(${node.nodes.map((n) => nodeToSql(n, alias, sink)).join(' OR ')})`;
  }
}

/**
 * Predicate for the `object` table under `alias`. `startParamIndex` is the next
 * free `$n` placeholder number for the caller's query.
 */
export function objectSqlFragment(
  scope: ResolvedScope,
  alias: string,
  startParamIndex: number,
): SqlFragment {
  const sink = new ParamSink(startParamIndex);
  const text = nodeToSql(objectRule(scope), alias, sink);
  return { text, params: sink.params };
}

/**
 * Predicate for a `relationship` row under `relAlias`, with its endpoint
 * `object` rows already joined under `fromAlias` / `toAlias`. Composes:
 * visible(from) ∧ visible(to) ∧ edgeRule.
 */
export function relationshipSqlFragment(
  scope: ResolvedScope,
  relAlias: string,
  fromAlias: string,
  toAlias: string,
  startParamIndex: number,
): SqlFragment {
  const sink = new ParamSink(startParamIndex);
  const fromText = nodeToSql(objectRule(scope), fromAlias, sink);
  const toText = nodeToSql(objectRule(scope), toAlias, sink);
  const edgeText = nodeToSql(relationshipEdgeRule(scope), relAlias, sink);
  return { text: `(${fromText} AND ${toText} AND ${edgeText})`, params: sink.params };
}

// --- JS interpreter --------------------------------------------------------

export interface ObjectVisibilityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly owner_id: string;
  readonly home_project_id: string | null;
}

export interface RelationshipVisibilityRow {
  readonly visibility_scope: string;
  readonly author_id: string | null;
  readonly from: ObjectVisibilityRow;
  readonly to: ObjectVisibilityRow;
}

function nodeEval(node: Node, row: Record<string, string | null>): boolean {
  switch (node.op) {
    case 'false':
      return false;
    case 'eq':
      return row[node.field] === node.value;
    case 'in': {
      const v = row[node.field];
      return v !== null && v !== undefined && node.values.includes(v);
    }
    case 'and':
      return node.nodes.every((n) => nodeEval(n, row));
    case 'or':
      return node.nodes.some((n) => nodeEval(n, row));
  }
}

export function canSeeObject(scope: ResolvedScope, row: ObjectVisibilityRow): boolean {
  return nodeEval(objectRule(scope), {
    id: row.id,
    workspace_id: row.workspace_id,
    owner_id: row.owner_id,
    home_project_id: row.home_project_id,
  });
}

export function canSeeRelationship(
  scope: ResolvedScope,
  row: RelationshipVisibilityRow,
): boolean {
  return (
    canSeeObject(scope, row.from) &&
    canSeeObject(scope, row.to) &&
    nodeEval(relationshipEdgeRule(scope), {
      visibility_scope: row.visibility_scope,
      author_id: row.author_id,
    })
  );
}
