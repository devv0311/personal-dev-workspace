// Use case: capture a Note into a Project (P2.7 §6).
//
// Path: authorization (scope + can-see project) → domain validation →
// ONE transaction { insert object + activity + audit + outbox } → return
// the authoritative object. The outbox event is written in the same txn (INV-13).

import type {
  ObjectRepository,
  UnitOfWork,
  ActivityWriter,
  AuditWriter,
  OutboxWriter,
} from '../ports/repositories.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import type { ProjectId } from '../domain/ids.ts';
import { asProjectId, asObjectId } from '../domain/ids.ts';
import type { WorkspaceObject } from '../domain/objects.ts';
import { validateNoteCapture } from '../domain/objects.ts';
import { forbidden, notFound } from '../domain/errors.ts';

export interface CaptureNoteDeps {
  uow: UnitOfWork;
  objects: ObjectRepository;
  activity: ActivityWriter;
  audit: AuditWriter;
  outbox: OutboxWriter;
}

export interface CaptureNoteCommand {
  scope: ResolvedScope;
  projectId: string;
  title?: unknown;
  body?: unknown;
}

export async function captureNote(
  deps: CaptureNoteDeps,
  cmd: CaptureNoteCommand,
): Promise<WorkspaceObject> {
  const projectId: ProjectId = asProjectId(cmd.projectId);

  // AUTHORIZATION before any write: the project must be visible to this scope.
  const project = await deps.objects.findVisible(cmd.scope, asObjectId(cmd.projectId));
  if (!project) {
    // Deny-by-default: indistinguishable "not found" for invisible/absent.
    throw notFound('Project not found.');
  }
  if (project.type !== 'project') {
    throw forbidden('Target is not a project.');
  }

  const clean = validateNoteCapture({ title: cmd.title, body: cmd.body });

  return deps.uow.transaction(async (tx) => {
    const note = await deps.objects.create(tx, {
      workspaceId: cmd.scope.workspaceId,
      type: 'note',
      title: clean.title,
      body: clean.body,
      attributes: {},
      homeProjectId: projectId, // singular home = belongs_to (P2.6 §8.2)
      ownerId: cmd.scope.principalId, // NOT NULL
      createdBy: cmd.scope.principalId, // immutable authorship
    });

    await deps.activity.append(tx, {
      objectId: note.id,
      workspaceId: note.workspaceId,
      kind: 'captured',
      actorId: cmd.scope.principalId,
      detail: { type: 'note', homeProjectId: projectId },
    });

    await deps.audit.append(tx, {
      workspaceId: note.workspaceId,
      actorId: cmd.scope.principalId,
      action: 'object.captured',
      supportingRefs: [note.id, projectId],
    });

    await deps.outbox.append(tx, {
      workspaceId: note.workspaceId,
      type: 'object.created',
      payload: { objectId: note.id, kind: 'created' }, // ids + kind only
    });

    return note;
  });
}
