// HTTP boundary (P2.7 §3, §6). Node's built-in http — no framework.
// Routes:
//   GET  /healthz
//   GET  /api/me
//   GET  /api/projects
//   GET  /api/projects/:id
//   POST /api/projects/:id/notes      { title?, body? }
//   static:  /  ->  adapters/web/*

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { config } from '../../config.ts';
import { buildContainer, type Container } from './container.ts';
import { principalFromRequest } from './auth.ts';
import { captureNote } from '../../application/capture-note.ts';
import { viewProject, listProjects } from '../../application/view-project.ts';
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
    res.writeHead(200, { 'content-type': type });
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

        if (method === 'GET' && path === '/api/projects') {
          const projects = await listProjects(container, scope);
          return send(res, 200, { projects });
        }

        const projMatch = /^\/api\/projects\/([0-9a-fA-F-]+)$/.exec(path);
        if (method === 'GET' && projMatch) {
          const view = await viewProject(container, scope, projMatch[1]!);
          return send(res, 200, view);
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
