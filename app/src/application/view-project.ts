// Use case: view a Project and its captured context (P2.7 §7).
// Read-only. Filter-first: the repositories apply the VisibilityPolicy fragment.

import type {
  ObjectRepository,
  RelationshipRepository,
} from '../ports/repositories.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import type { WorkspaceObject } from '../domain/objects.ts';
import type { RelationshipEdge } from '../domain/relationships.ts';
import { asProjectId, asObjectId } from '../domain/ids.ts';
import { notFound } from '../domain/errors.ts';

export interface ViewProjectDeps {
  objects: ObjectRepository;
  relationships: RelationshipRepository;
}

export interface ProjectContextView {
  project: WorkspaceObject;
  captures: Array<{
    object: WorkspaceObject;
    anchoredBy: RelationshipEdge; // the belongs_to edge (synthesised from home_project_id)
  }>;
}

export async function viewProject(
  deps: ViewProjectDeps,
  scope: ResolvedScope,
  projectIdRaw: string,
): Promise<ProjectContextView> {
  const projectId = asProjectId(projectIdRaw);
  const project = await deps.objects.findVisible(scope, asObjectId(projectIdRaw));
  if (!project || project.type !== 'project') {
    throw notFound('Project not found.');
  }

  const children = await deps.objects.listByHomeProject(scope, projectId);

  const captures = [];
  for (const child of children) {
    const edges = await deps.relationships.forObject(scope, child.id);
    const anchoredBy = edges.find(
      (e) => e.verb === 'belongs_to' && e.toObjectId === project.id,
    );
    if (anchoredBy) {
      captures.push({ object: child, anchoredBy });
    }
  }

  return { project, captures };
}

export async function listProjects(
  deps: ViewProjectDeps,
  scope: ResolvedScope,
): Promise<WorkspaceObject[]> {
  return deps.objects.listProjects(scope);
}
