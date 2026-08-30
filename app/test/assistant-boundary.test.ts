// P3.4 — INV-4 as an ARCHITECTURE test, not a convention.
//
// P2.6 §14.2 is explicit that the assistant's process boundary protects exactly
// one property: no code path in the component that talks to an external model
// can read the datastore. That claim is only true if it is checked. A comment
// saying "no DB here" is worth nothing the first time someone adds an import.
//
// This walks the assistant's real module graph from its entry point and fails
// if anything in it can reach persistence or a driver.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assistantDir = resolve(here, '../assistant');

/** Follow every relative import from `entry`, returning the reachable files. */
async function moduleGraph(entry: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    seen.set(file, source);
    for (const m of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      queue.push(resolve(dirname(file), m[1]!));
    }
  }
  return seen;
}

test('the assistant build graph contains no database driver or persistence path (INV-4)', async () => {
  const graph = await moduleGraph(join(assistantDir, 'index.ts'));
  assert.ok(graph.size >= 5, `expected a real graph, walked ${graph.size} files`);

  const offenders: string[] = [];
  for (const [file, source] of graph) {
    // The assistant may import shared CONFIG and TYPES, but nothing that can
    // execute a query.
    if (/from\s+['"]pg['"]/.test(source)) offenders.push(`${file}: imports pg`);
    if (/adapters\/persistence/.test(source)) offenders.push(`${file}: reaches adapters/persistence`);
    if (/\bnew\s+pg\./.test(source) || /getPool\(/.test(source)) {
      offenders.push(`${file}: touches the connection pool`);
    }
  }
  assert.deepEqual(offenders, [], 'the assistant must have no path to the datastore');
});

test('the assistant holds no write authority — its only core call is the Context API', async () => {
  const graph = await moduleGraph(join(assistantDir, 'index.ts'));
  const coreCalls = new Set<string>();
  for (const source of graph.values()) {
    for (const m of source.matchAll(/\$\{[^}]*baseUrl[^}]*\}([^`'"]*)/g)) coreCalls.add(m[1]!);
  }
  // The assistant reads context and nothing else. Task creation happens in the
  // CORE, initiated by the user's own request (INV-8).
  assert.deepEqual([...coreCalls], ['/ctx/context-set']);

  for (const [file, source] of graph) {
    assert.ok(
      !/\/api\/projects\/[^`'"]*\/(notes|tasks)/.test(source),
      `${file} must not call a core write endpoint`,
    );
  }
});
