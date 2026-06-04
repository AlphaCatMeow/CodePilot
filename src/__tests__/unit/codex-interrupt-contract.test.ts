/**
 * Phase 5 Phase 4 Slice 3 — Codex turn/interrupt contract.
 *
 * `turn/interrupt` in Codex requires `{ threadId, turnId }` per
 * `资料/codex/.../v2/TurnInterruptParams.ts`. Earlier revision logged
 * + no-op'd because turnId wasn't tracked. Slice 3 captures the
 * turnId returned by `turn/start` into an in-process map; interrupt
 * reads from it.
 *
 * Source-level pin (rather than runtime-executed) because the full
 * code path requires a live Codex app-server. Asserts the structural
 * contract is in place:
 *
 *   1. activeCodexTurns map exists at module scope
 *   2. turn/start response → activeCodexTurns.set with both ids
 *   3. canonical run_completed | run_failed → activeCodexTurns.delete
 *      (so a stale entry can't drive interrupt after the turn finishes)
 *   4. interrupt() reads the entry and issues turn/interrupt with
 *      both ids
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/runtime.ts'),
  'utf8',
);

describe('Codex turn/interrupt — Slice 3 contract', () => {
  it('activeCodexTurns map declared at module scope', () => {
    assert.match(
      runtimeSrc,
      /const\s+activeCodexTurns\s*=\s*new\s+Map<\s*string,\s*\{[\s\S]{0,200}threadId:\s*string[\s\S]{0,200}turnId:\s*string/,
    );
  });

  it('turn/start response → activeCodexTurns.set with (threadId, turnId)', () => {
    // After turn/start resolves we capture the returned turn id so a
    // later interrupt() can find it. The set call must include both
    // threadId AND turnId from the response.
    assert.match(
      runtimeSrc,
      /turn\/start[\s\S]{0,1500}activeCodexTurns\.set\(sessionId,\s*\{\s*threadId,\s*turnId:\s*turnResult\.turn\.id\s*\}\)/,
    );
  });

  it('canonical run_completed | run_failed → activeCodexTurns.delete (no stale entries)', () => {
    // Stream-close branch must drop the active-turn entry so a future
    // interrupt() against this session doesn't chase a stale turnId.
    assert.match(
      runtimeSrc,
      /event\?\.type\s*===\s*'run_completed'\s*\|\|\s*event\?\.type\s*===\s*'run_failed'[\s\S]{0,500}activeCodexTurns\.delete\(sessionId\)/,
    );
  });

  it('interrupt(sessionId) reads activeCodexTurns and calls turn/interrupt with both ids', () => {
    // The interrupt method must look up the (threadId, turnId) pair
    // and issue the JSON-RPC request. Schema requires both ids per
    // TurnInterruptParams.
    assert.match(
      runtimeSrc,
      /interrupt\(sessionId:[\s\S]{0,2000}activeCodexTurns\.get\(sessionId\)/,
    );
    assert.match(
      runtimeSrc,
      /turn\/interrupt[\s\S]{0,500}threadId:\s*active\.threadId[\s\S]{0,500}turnId:\s*active\.turnId/,
    );
  });

  it('interrupt() short-circuits when no active turn (no JSON-RPC call)', () => {
    // Race-against-completion case: if the entry is missing (turn
    // already finished), interrupt no-ops with a debug log — never
    // sends turn/interrupt with stale state.
    assert.match(
      runtimeSrc,
      /interrupt\(sessionId:[\s\S]{0,2000}if\s*\(!active\)\s*\{[\s\S]{0,500}return/,
    );
  });
});
