// ASSISTANT SERVICE — Zone B (P2.6 §4, §14).
//
// A separate deployable with NO datastore credentials and NO database route.
// Its whole reach is: the Context API (for evidence, using the caller's own
// forwarded credential) and the model provider (for generation). It cannot
// write anything anywhere — task creation goes back through the CORE's normal
// authenticated write API, initiated by the user (INV-8).
//
// What the process boundary buys (P2.6 §14.2): no code path in the component
// that talks to an external model can read the datastore, because there is no
// path to it. That is enforced by construction here — this build graph contains
// no database driver — and asserted by a test.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from '../src/config.ts';
import { makeContextClient } from './context-client.ts';
import { makeFakeLLMProvider } from './adapters/fake-llm.ts';
import { makeAnthropicLLMProvider } from './adapters/anthropic-llm.ts';
import { runAsk, type AskOutcome } from './pipeline.ts';
import type { LLMProvider } from './ports/llm.ts';

/**
 * Provider selection: deterministic fake unless a key is present. The
 * architecture never assumes a vendor — the real adapter is opt-in.
 */
export function selectProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const apiKey = env['ANTHROPIC_API_KEY'];
  if (apiKey && apiKey.trim()) {
    return makeAnthropicLLMProvider({
      apiKey: apiKey.trim(),
      ...(env['ASSISTANT_MODEL'] ? { model: env['ASSISTANT_MODEL'] } : {}),
    });
  }
  return makeFakeLLMProvider();
}

function send(res: ServerResponse, status: number, body: unknown, origin: string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 200_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

export function createAssistantApp(
  deps: {
    context: ReturnType<typeof makeContextClient>;
    llm: LLMProvider;
  } = {
    context: makeContextClient({
      baseUrl: config.coreContextApiUrl,
      serviceToken: config.contextApiServiceToken,
    }),
    llm: selectProvider(),
  },
) {
  const origin = config.assistantAllowedOrigin;
  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (method === 'OPTIONS') return send(res, 204, {}, origin);

    if (method === 'GET' && url.pathname === '/healthz') {
      return send(res, 200, { status: 'ok', provider: deps.llm.describe() }, origin);
    }

    if (method === 'POST' && url.pathname === '/ask') {
      try {
        // The user's own credential, exactly as their browser sent it. The
        // assistant relays it; it never asserts an identity of its own.
        const userCredential = req.headers['authorization'];
        if (typeof userCredential !== 'string' || !userCredential) {
          return send(res, 401, { ok: false, stage: 'context', reason: 'not_authenticated', detail: 'Sign in first.' }, origin);
        }
        const body = await readJson(req);
        // The requested model / effort are passed through UNVALIDATED here and
        // validated by the pipeline against what the provider can actually run.
        // One validation point, so no route can bypass it (T3.3-CORRECTION).
        const outcome: AskOutcome = await runAsk(deps, {
          question: typeof body['question'] === 'string' ? body['question'] : '',
          userCredential,
          targetId: typeof body['targetId'] === 'string' ? body['targetId'] : null,
          model: body['model'],
          effort: body['effort'],
        });
        return send(res, outcome.ok ? 200 : 502, outcome, origin);
      } catch (err) {
        console.error('[assistant] unhandled', err);
        return send(res, 500, { ok: false, stage: 'model', reason: 'internal', detail: 'internal error' }, origin);
      }
    }

    return send(res, 404, { error: 'not found' }, origin);
  });
}

if (import.meta.main) {
  const llm = selectProvider();
  const server = createAssistantApp({
    context: makeContextClient({
      baseUrl: config.coreContextApiUrl,
      serviceToken: config.contextApiServiceToken,
    }),
    llm,
  });
  server.listen(config.assistantPort, () => {
    console.log(
      `assistant listening on http://localhost:${config.assistantPort}  ` +
        `(provider: ${llm.describe().kind}/${llm.describe().model}, core: ${config.coreContextApiUrl})`,
    );
  });
}
