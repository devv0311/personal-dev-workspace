// Branded identifiers so the compiler distinguishes id kinds (P2.6 §6: domain is pure).

export type Brand<K, T> = K & { readonly __brand: T };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type PrincipalId = Brand<string, 'PrincipalId'>;
export type ObjectId = Brand<string, 'ObjectId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type RelationshipId = Brand<string, 'RelationshipId'>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export const asWorkspaceId = (v: string) => v as WorkspaceId;
export const asPrincipalId = (v: string) => v as PrincipalId;
export const asObjectId = (v: string) => v as ObjectId;
export const asProjectId = (v: string) => v as ProjectId;
export const asRelationshipId = (v: string) => v as RelationshipId;
