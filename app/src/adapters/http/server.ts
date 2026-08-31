// HTTP boundary (P2.7 §3, §6). Node's built-in http — no framework.
// Routes:
//   GET  /healthz
//   GET  /api/me
//   GET  /api/projects
//   GET  /api/projects/:id
//   POST /api/projects/:id/notes      { title?, body? }
//   POST /api/projects/:id/tasks      { title?, body?, sourceObjectId? }  (confirmed)
//   GET  /api/graph                   context graph read model (P3.2)
//   GET  /api/objects/:id             one object + its edges (Context Inspector)
//   POST /ctx/context-set             Context API — assistant-facing (P2.6 §10, §14.1)
//   static:  /  ->  adapters/web/*

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from '../../config.ts';
import { buildContainer, type Container } from './container.ts';
import { principalFromRequest } from './auth.ts';
import { captureNote } from '../../application/capture-note.ts';
import { createTask } from '../../application/create-task.ts';
import { viewProject, listProjects } from '../../application/view-project.ts';
import { buildContextGraph, inspectObject } from '../../application/context-graph.ts';
import { assembleContextSet } from '../../application/context-set.ts';
import { DomainError } from '../../domain/errors.ts';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '../web');

const STATUS_BY_CODE: Record<string, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new DomainError('validation', 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new DomainError('validation', 'Invalid JSON body.');
  }
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === '/' ? 'index.html' : normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const full = join(webDir, rel);
  if (!full.startsWith(webDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(full);
    const type = rel.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : rel.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : rel.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'application/octet-stream';
    // Dev server: never cache the shell, so an edited asset is always the one
    // under test.
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

export function createApp(container: Container = buildContainer()) {
  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://localhost`);
    const path = url.pathname;

    try {
      if (method === 'GET' && path === '/healthz') {
        await container.uow.query('SELECT 1');
        return send(res, 200, { status: 'ok' });
      }

      // ---------------------------------------------------------------------
      // CONTEXT API (P2.6 §10, §14.1) — the assistant's ONLY data path.
      //
      // Two independent credentials with different jobs:
      //   1. X-Service-Token  authenticates the CALLER (the assistant service)
      //      and authorises it to reach this surface. It conveys NO user identity.
      //   2. Authorization    is the END USER's own credential, relayed
      //      unmodified by the assistant. The core validates it itself and
      //      derives Principal from it.
      //
      // A call presenting only a service token is rejected: there is no user to
      // act for. The principal is NEVER read from a body field or an
      // assistant-set header, so the assistant cannot supply, substitute or
      // elevate a principal (INV-4a) — it holds no credential for anyone but
      // the user currently talking to it.
      if (path === '/ctx/context-set') {
        if (method !== 'POST') return send(res, 404, { error: 'not found' });

        const serviceToken = req.headers['x-service-token'];
        if (
          typeof serviceToken !== 'string' ||
          serviceToken !== config.contextApiServiceToken
        ) {
          return send(res, 401, { error: 'service token required' });
        }

        // The end user's own credential — validated here, by the core.
        const principalId = principalFromRequest(req);
        if (!principalId) {
          return send(res, 401, { error: 'end-user credential required' });
        }
        const ctxScope = await container.scopeResolver.resolve(principalId);
        if (!ctxScope) return send(res, 401, { error: 'unknown principal' });

        const body = await readJson(req);
        const purposeRaw = body['purpose'];
        const purpose =
          purposeRaw === 'summarize' || purposeRaw === 'extract_tasks' ? purposeRaw : 'question';
        const result = await assembleContextSet(container, ctxScope, {
          purpose,
          queryText: typeof body['queryText'] === 'string' ? body['queryText'] : '',
          targetId: typeof body['targetId'] === 'string' ? body['targetId'] : null,
        });
        // Unavailable is a distinct result from an empty set (P2.6 §10.3).
        return send(res, result.ok ? 200 : 409, result);
      }

      if (path.startsWith('/api/')) {
        // --- AUTHORIZATION: resolve principal, then the per-request scope, once.
        const principalId = principalFromRequest(req);
        if (!principalId) return send(res, 401, { error: 'authentication required' });
        const scope = await container.scopeResolver.resolve(principalId);
        if (!scope) return send(res, 401, { error: 'unknown principal' });

        if (method === 'GET' && path === '/api/me') {
          return send(res, 200, {
            principalId: scope.principalId,
            workspaceId: scope.workspaceId,
            sharedProjectIds: scope.sharedProjectIds,
          });
        }

        // Workspace membership. Two columns — id and display name — because
        // that is all the model records about a person (T3.2 §13). No e-mail,
        // avatar, role, external account or activity exists to return.
        if (method === 'GET' && path === '/api/workspace/members') {
          const members = await container.members.listMembers(scope);
          return send(res, 200, { members });
        }

        if (method === 'GET' && path === '/api/graph') {
          // Server-side authorization: the graph is assembled from the same
          // scope-filtered repositories as every other read. Client-side
          // filtering is a view concern only — never the security boundary.
          const graph = await buildContextGraph(container, scope);
          return send(res, 200, graph);
        }

        const objMatch = /^\/api\/objects\/([0-9a-fA-F-]+)$/.exec(path);
        if (method === 'GET' && objMatch) {
          const inspection = await inspectObject(container, scope, objMatch[1]!);
          return send(res, 200, inspection);
        }

        if (method === 'GET' && path === '/api/projects') {
          const projects = await listProjects(container, scope);
          return send(res, 200, { projects });
        }

        const projMatch = /^\/api\/projects\/([0-9a-fA-F-]+)$/.exec(path);
        if (method === 'GET' && projMatch) {
          const view = await viewProject(container, scope, projMatch[1]!);
          return send(res, 200, view);
        }

        // Confirmed task creation. The assistant proposes; only a user
        // request carrying their own credential reaches this (INV-8).
        const taskMatch = /^\/api\/projects\/([0-9a-fA-F-]+)\/tasks$/.exec(path);
        if (method === 'POST' && taskMatch) {
          const body = await readJson(req);
          const task = await createTask(container, {
            scope,
            projectId: taskMatch[1]!,
            title: body['title'],
            body: body['body'],
            sourceObjectId:
              typeof body['sourceObjectId'] === 'string' ? body['sourceObjectId'] : null,
            assistantAssisted: body['assistantAssisted'] === true,
          });
          return send(res, 201, { task });
        }

        const noteMatch = /^\/api\/projects\/([0-9a-fA-F-]+)\/notes$/.exec(path);
        if (method === 'POST' && noteMatch) {
          const body = await readJson(req);
          const note = await captureNote(container, {
            scope,
            projectId: noteMatch[1]!,
            title: body['title'],
            body: body['body'],
          });
          return send(res, 201, { note });
        }

        return send(res, 404, { error: 'not found' });
      }

      if (method === 'GET') {
        return serveStatic(res, path);
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof DomainError) {
        return send(res, STATUS_BY_CODE[err.code] ?? 400, {
          error: err.message,
          code: err.code,
        });
      }
      console.error('[server] unhandled error', err);
      return send(res, 500, { error: 'internal error' });
    }
  });
}

if (import.meta.main) {
  const server = createApp();
  server.listen(config.port, () => {
    console.log(
      `core listening on http://localhost:${config.port}  (db: ${config.databaseUrl})`,
    );
  });
}
