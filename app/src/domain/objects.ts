// Object domain model (P2.6 §7, §12.1). Pure.

import type { ObjectId, PrincipalId, ProjectId, WorkspaceId } from './ids.ts';
import { validation } from './errors.ts';

export const OBJECT_TYPES = [
  'project',
  'task',
  'note',
  'idea',
  'decision',
  'resource',
  'checkpoint',
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export interface WorkspaceObject {
  readonly id: ObjectId;
  readonly workspaceId: WorkspaceId;
  readonly type: ObjectType;
  readonly title: string;
  readonly body: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly homeProjectId: ProjectId | null; // null ⇒ Inbox
  readonly ownerId: PrincipalId; // NOT NULL (P2.6 review correction)
  readonly createdBy: PrincipalId; // immutable authorship
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NoteCaptureInput {
  readonly title: string;
  readonly body: string;
}

const MAX_TITLE = 200;
const MAX_BODY = 20_000;

/**
 * Validate a note capture. Capture is deliberately low-friction (P2.1 §7):
 * body may be empty if a title is present, and vice versa — but not both empty.
 */
export function validateNoteCapture(input: {
  title?: unknown;
  body?: unknown;
}): NoteCaptureInput {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!title && !body) {
    throw validation('A note needs a title or a body.');
  }
  if (title.length > MAX_TITLE) {
    throw validation(`Title must be ${MAX_TITLE} characters or fewer.`);
  }
  if (body.length > MAX_BODY) {
    throw validation(`Body must be ${MAX_BODY} characters or fewer.`);
  }
  return { title, body };
}
