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
//   GET  /api/external/github         external repository activity (T3.3.1)
//   GET  /api/system/worker           background execution records (T3.3.4)
//   GET  /api/artifacts               produced outputs — the command orbit
//   POST /api/artifacts/read          { ref }  per-principal read state
//   GET  /api/inbound                 Attention Stack — multi-source queue
//   GET  /api/mail/accounts           the CALLER's own mail accounts
//   POST /api/mail/accounts           { provider, accountId? } → consent URL
//   PATCH  /api/mail/accounts/:id     { feedsInbound }
//   DELETE /api/mail/accounts/:id     disconnect
//   GET  /oauth/mail/callback         provider redirect (carries no credential
//                                     of ours — bound by a single-use state)
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
import { readExternalActivity } from '../../application/external-activity.ts';
import { readWorkerActivity } from '../../application/worker-activity.ts';
import { markArtifactRead, readArtifactFeed } from '../../application/artifacts.ts';
import { readInboundQueue } from '../../application/inbound-queue.ts';
import {
  beginMailConnect,
  completeMailConnect,
  disconnectMailAccount,
  listMailAccounts,
  setMailAccountFeeds,
} from '../../application/mail-accounts.ts';
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

/** Escape before interpolating anything into the callback page. */
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

/**
 * The one HTML page this server renders itself: the mail provider's redirect
 * target. It states the outcome and nothing else — no token, no code, no state
 * — and closes itself when it was opened as a consent window.
 */
function sendCallbackPage(
  res: ServerResponse,
  status: number,
  message: string,
  ok = false,
): void {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>DEVWORKSPACE — mail</title>
<style>
 body{margin:0;background:#000;color:#ececee;font:400 13px/1.5 system-ui,-apple-system,sans-serif;
      display:grid;place-content:center;height:100vh;text-align:center;gap:10px}
 .k{font:600 9px/1 system-ui;letter-spacing:.18em;text-transform:uppercase;color:${ok ? '#55d6a0' : '#ff5c78'}}
 .m{color:#9aa0a7;max-width:38ch}
 a{color:#ff7a1a}
</style></head><body>
<div class="k">${ok ? 'Mail account connected' : 'Not connected'}</div>
<div class="m">${escapeHtml(message)}</div>
<a href="/">Return to DEVWORKSPACE</a>
<script>
  // Opened as a consent window: tell the opener to re-read its own accounts,
  // then close. No credential is passed — the opener asks the server.
  try { if (window.opener) { window.opener.postMessage({ type: 'devworkspace:mail', ok: ${ok} }, window.location.origin); setTimeout(function(){ window.close(); }, 900); } } catch (e) {}
</script>
</body></html>`;
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
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

      // ---------------------------------------------------------------------
      // MAIL OAUTH CALLBACK (T3.3-CORRECTION).
      //
      // This route sits OUTSIDE /api/ deliberately. It is a top-level browser
      // navigation initiated by the mail provider, so it cannot carry the
      // application's own credential; requiring one here would make the flow
      // impossible rather than making it safer.
      //
      // What authorises it instead is the single-use `state` this server minted
      // and stored against the principal who started the flow. The row is
      // deleted as it is read and it carries an expiry, so an unknown, expired
      // or replayed state completes nothing. The authorization code is
      // exchanged server-side; no token ever reaches this response.
      if (method === 'GET' && path === '/oauth/mail/callback') {
        const state = url.searchParams.get('state') ?? '';
        const code = url.searchParams.get('code') ?? '';
        const providerError = url.searchParams.get('error');
        if (providerError) {
          // The provider's own refusal, reported as a refusal.
          return sendCallbackPage(res, 400, `The provider refused: ${providerError}`);
        }
        if (!state || !code) {
          return sendCallbackPage(res, 400, 'That mail authorization is incomplete.');
        }
        try {
          const { account } = await completeMailConnect(container, { state, code });
          return sendCallbackPage(res, 200, `Connected ${account.address}.`, true);
        } catch (err) {
          const message =
            err instanceof DomainError ? err.message : 'The mail account could not be connected.';
          return sendCallbackPage(res, 400, message);
        }
      }

      if (path.startsWith('/api/')) {
        // --- AUTHORIZATION: resolve principal, then the per-request scope, once.
        const principalId = principalFromRequest(req);
        if (!principalId) return send(res, 401, { error: 'authentication required' });
        const scope = await container.scopeResolver.resolve(principalId);
        if (!scope) return send(res, 401, { error: 'unknown principal' });

        if (method === 'GET' && path === '/api/me') {
          // The current identity, named by the server from the principal row the
          // credential actually resolved to (T3.3.2). The client no longer holds
          // a table of principal labels: a name shown in the header is one the
          // datastore returned for the authenticated principal, so it cannot be
          // a stale or invented identity.
          //
          // T3.3-CORRECTION: two DIFFERENT identities are reported, because the
          // UI must be able to state both without conflating them —
          //   `self`      the person whose credential this is, whoever they are;
          //   `workspace.head`  the member whose membership carries the `owner`
          //                     role, read back from that row.
          // Neither is hardcoded, and a workspace with no head reports null
          // rather than a guess.
          const members = await container.members.listMembers(scope);
          const self = members.find((m) => m.id === scope.principalId) ?? null;
          const workspace = await container.members.readWorkspace(scope);
          return send(res, 200, {
            principalId: scope.principalId,
            workspaceId: scope.workspaceId,
            displayName: self?.displayName ?? null,
            role: self?.role ?? null,
            isWorkspaceHead: self?.role === 'owner',
            workspace: workspace
              ? { id: workspace.id, name: workspace.name, head: workspace.head }
              : null,
            sharedProjectIds: scope.sharedProjectIds,
          });
        }

        // External repository activity. GitHub supplies activity only; it is
        // never the system of record for a DEVWORKSPACE object, and this route
        // has no write. It sits behind the same authenticated-scope gate as
        // every other /api/ read, and the internal anchors it returns are
        // resolved through the ordinary VisibilityPolicy (T3.3.1).
        if (method === 'GET' && path === '/api/external/github') {
          const activity = await readExternalActivity(container, scope);
          return send(res, 200, activity);
        }

        // Background execution records. Real outbox-worker outcomes over
        // objects this scope may see — never a fabricated schedule (T3.3.4).
        if (method === 'GET' && path === '/api/system/worker') {
          const worker = await readWorkerActivity(
            container,
            scope,
            config.workerPollIntervalMs,
          );
          return send(res, 200, worker);
        }

        // Workspace membership. Three columns — id, display name and the
        // membership role — because that is all the model records about a
        // person (T3.2 §13; role added at T3.3-CORRECTION). No e-mail, avatar,
        // permission tier, external account or activity exists to return.
        if (method === 'GET' && path === '/api/workspace/members') {
          const members = await container.members.listMembers(scope);
          const workspace = await container.members.readWorkspace(scope);
          return send(res, 200, { members, workspace });
        }

        // Produced outputs — the command centre's artifact orbit. The worker
        // telemetry is read once and shared with the feed, so the orbit and the
        // Routines rail can never describe the same run differently.
        if (method === 'GET' && path === '/api/artifacts') {
          const worker = await readWorkerActivity(
            container,
            scope,
            config.workerPollIntervalMs,
          );
          const feed = await readArtifactFeed(container, scope, worker);
          return send(res, 200, feed);
        }

        // Per-principal read state. Marking an artifact read affects this
        // principal's rows only — there is no unscoped write behind it.
        if (method === 'POST' && path === '/api/artifacts/read') {
          const body = await readJson(req);
          const ref = body['ref'];
          if (typeof ref !== 'string' || !ref) {
            throw new DomainError('validation', 'An artifact reference is required.');
          }
          await markArtifactRead(container, scope, ref);
          return send(res, 200, { ok: true, ref });
        }

        // The Attention Stack. Many sources, each stating its own condition;
        // mail items come only from accounts THIS principal connected.
        if (method === 'GET' && path === '/api/inbound') {
          const queue = await readInboundQueue(container, scope);
          return send(res, 200, queue);
        }

        // ---------------------------------------------------------------
        // MAIL ACCOUNTS. Every route below is scoped to the caller's own
        // principal by the repository beneath it: a foreign account id is
        // indistinguishable from an unknown one, and no route accepts a
        // principal from the client.
        if (path === '/api/mail/accounts') {
          if (method === 'GET') {
            return send(res, 200, await listMailAccounts(container, scope));
          }
          if (method === 'POST') {
            const body = await readJson(req);
            const started = await beginMailConnect(container, scope, {
              provider: body['provider'],
              redirectUri: `${config.mailRedirectBase}/oauth/mail/callback`,
              accountId: typeof body['accountId'] === 'string' ? body['accountId'] : null,
            });
            // Only the provider's own consent URL crosses to the browser. No
            // client secret, no state secret beyond the one the provider will
            // echo back, and no token.
            return send(res, 200, { authorizationUrl: started.authorizationUrl });
          }
          return send(res, 405, { error: 'method not allowed' });
        }

        const mailAccountMatch = /^\/api\/mail\/accounts\/([0-9a-fA-F-]+)$/.exec(path);
        if (mailAccountMatch) {
          const id = mailAccountMatch[1]!;
          if (method === 'DELETE') {
            await disconnectMailAccount(container, scope, id);
            return send(res, 200, { ok: true });
          }
          if (method === 'PATCH') {
            const body = await readJson(req);
            if (typeof body['feedsInbound'] !== 'boolean') {
              throw new DomainError('validation', 'feedsInbound must be true or false.');
            }
            const account = await setMailAccountFeeds(
              container,
              scope,
              id,
              body['feedsInbound'],
            );
            return send(res, 200, { account });
          }
          return send(res, 405, { error: 'method not allowed' });
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
