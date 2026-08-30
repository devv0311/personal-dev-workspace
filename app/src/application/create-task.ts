// Use case: create a Task from a confirmed user action (P2.3 §9, INV-8).
//
// The assistant may PROPOSE tasks; it can never create one. This use case is
// reached only by an explicit user confirmation carrying that user's own
// credential, and it is attributed to the user — never to the model. There is
// no assistant-authenticated path to it (the assistant holds no datastore
// credential and no write token at all).
//
// Structurally identical to captureNote (P2.7): authorization before any write,
// then ONE transaction over the atomic set { object + activity + audit +
// outbox }. `sourceObjectId` records which captured context the task was
// extracted from, so the provenance of an AI-assisted creation survives.

import type {
  ObjectRepository,
  UnitOfWork,
  ActivityWriter,
  AuditWriter,
  OutboxWriter,
  RelationshipRepository,
} from '../ports/repositories.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import type { ProjectId } from '../domain/ids.ts';
import { asProjectId, asObjectId } from '../domain/ids.ts';
import type { WorkspaceObject } from '../domain/objects.ts';
import { validateNoteCapture } from '../domain/objects.ts';
import { forbidden, notFound } from '../domain/errors.ts';

export interface CreateTaskDeps {
  uow: UnitOfWork;
  objects: ObjectRepository;
  relationships: RelationshipRepository;
  activity: ActivityWriter;
  audit: AuditWriter;
  outbox: OutboxWriter;
}

export interface CreateTaskCommand {
  scope: ResolvedScope;
  projectId: string;
  title?: unknown;
  body?: unknown;
  /** The captured object this task was extracted from, if any. */
  sourceObjectId?: string | null;
  /** True when the text originated from an assistant proposal the user confirmed. */
  assistantAssisted?: boolean;
}

export async function createTask(
  deps: CreateTaskDeps,
  cmd: CreateTaskCommand,
): Promise<WorkspaceObject> {
  const projectId: ProjectId = asProjectId(cmd.projectId);

  // AUTHORIZATION before any write, exactly as captureNote does.
  const project = await deps.objects.findVisible(cmd.scope, asObjectId(cmd.projectId));
  if (!project) throw notFound('Project not found.');
  if (project.type !== 'project') throw forbidden('Target is not a project.');

  // A task carries the same title/body validation as any captured object.
  const clean = validateNoteCapture({ title: cmd.title, body: cmd.body });

  // The source must itself be visible to this principal before we reference it.
  let sourceId: string | null = null;
  if (cmd.sourceObjectId) {
    const source = await deps.objects.findVisible(cmd.scope, asObjectId(cmd.sourceObjectId));
    if (source) sourceId = source.id;
  }

  return deps.uow.transaction(async (tx) => {
    const task = await deps.objects.create(tx, {
      workspaceId: cmd.scope.workspaceId,
      type: 'task',
      title: clean.title,
      body: clean.body,
      attributes: {
        status: 'open',
        // Recorded as an attribute, not as authorship: the USER is the author.
        ...(cmd.assistantAssisted ? { createdVia: 'assistant_proposal' } : {}),
        ...(sourceId ? { extractedFrom: sourceId } : {}),
      },
      homeProjectId: projectId,
      ownerId: cmd.scope.principalId,
      createdBy: cmd.scope.principalId, // attributed to the user (P2.3 §9)
    });

    // A real, first-class relationship back to the context it came from —
    // not a denormalised field (INV-2).
    if (sourceId) {
      await deps.relationships.create(tx, {
        workspaceId: cmd.scope.workspaceId,
        fromObjectId: task.id,
        toObjectId: asObjectId(sourceId),
        verb: 'derived_from',
        origin: 'user_confirmed',
        confidenceState: 'user_confirmed',
        authorId: cmd.scope.principalId,
        visibilityScope: 'shared',
        provenance: {
          kind: cmd.assistantAssisted ? 'assistant_proposal:user_confirmed' : 'user',
          detail: {},
        },
      });
    }

    await deps.activity.append(tx, {
      objectId: task.id,
      workspaceId: task.workspaceId,
      kind: 'created',
      actorId: cmd.scope.principalId,
      detail: { type: 'task', homeProjectId: projectId, assisted: !!cmd.assistantAssisted },
    });

    await deps.audit.append(tx, {
      workspaceId: task.workspaceId,
      actorId: cmd.scope.principalId,
      action: 'task.created',
      supportingRefs: sourceId ? [task.id, projectId, sourceId] : [task.id, projectId],
    });

    await deps.outbox.append(tx, {
      workspaceId: task.workspaceId,
      type: 'object.created',
      payload: { objectId: task.id, kind: 'created' },
    });

    return task;
  });
}
