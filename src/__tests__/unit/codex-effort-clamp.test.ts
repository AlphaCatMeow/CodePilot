/**
 * P1 (2026-06-01) — Codex effort clamp regression.
 *
 * The codex_runtime `turn/start` path must never forward CodePilot's
 * Opus-only effort tiers (`xhigh` / `max`) to the Codex app-server, which
 * only accepts `minimal | low | medium | high`. Older codex builds reject
 * unknown variants fatally; even 0.133 only tolerates them with a warning.
 *
 * Scope guard: this clamp is codex-only. Claude Code / Native must keep the
 * full union for Anthropic Opus 4.7/4.8 — they do NOT import clampCodexEffort.
 *
 * See docs/research/packaged-preview-runtime-diagnosis-2026-05-31.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clampCodexEffort, CODEX_SUPPORTED_EFFORTS } from '@/lib/codex/effort';

describe('clampCodexEffort — Opus-only tiers clamp to high', () => {
  it('maps xhigh → high', () => {
    assert.equal(clampCodexEffort('xhigh'), 'high');
  });

  it('maps max → high', () => {
    assert.equal(clampCodexEffort('max'), 'high');
  });
});

describe('clampCodexEffort — Codex-supported levels pass through unchanged', () => {
  for (const level of ['minimal', 'low', 'medium', 'high'] as const) {
    it(`keeps ${level} as-is`, () => {
      assert.equal(clampCodexEffort(level), level);
    });
  }
});

describe('clampCodexEffort — absent / unknown is omitted (let Codex default)', () => {
  it('returns undefined for undefined', () => {
    assert.equal(clampCodexEffort(undefined), undefined);
  });
  it('returns undefined for null', () => {
    assert.equal(clampCodexEffort(null), undefined);
  });
  it('returns undefined for empty string', () => {
    assert.equal(clampCodexEffort(''), undefined);
  });
  it('returns undefined for an unrecognized value rather than forwarding it', () => {
    assert.equal(clampCodexEffort('ultra-mega'), undefined);
  });
});

describe('CODEX_SUPPORTED_EFFORTS — contract', () => {
  it('is exactly the four levels Codex accepts (no xhigh/max)', () => {
    assert.deepEqual([...CODEX_SUPPORTED_EFFORTS], ['minimal', 'low', 'medium', 'high']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Wiring pin — the clampCodexEffort unit tests above prove the helper,
// but they don't prove runtime.ts actually USES it. The runtime function
// spawns the app-server (can't mock without dragging the whole subprocess
// machinery into a unit test), so we pin the turn/start wiring at the
// source level — same convention as the thread/start + thread/resume pins
// in codex-runtime-proxy-injection.test.ts. Catches a revert to raw
// `options.effort` (which would silently leak Opus-only xhigh/max to Codex)
// at zero runtime cost, even though the helper tests stay green.
// ─────────────────────────────────────────────────────────────────────

describe('CodexRuntime turn/start — effort wiring pin (codexEffort, not raw options.effort)', () => {
  const runtimeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../lib/codex/runtime.ts'),
    'utf8',
  );

  it('imports clampCodexEffort from ./effort', () => {
    assert.match(
      runtimeSrc,
      /import\s*\{\s*clampCodexEffort\s*\}\s*from\s*['"]\.\/effort['"]/,
      'runtime.ts must import clampCodexEffort from ./effort',
    );
  });

  it('computes codexEffort = clampCodexEffort(options.effort) before the turn', () => {
    assert.match(
      runtimeSrc,
      /const\s+codexEffort\s*=\s*clampCodexEffort\(\s*options\.effort\s*\)/,
      'runtime.ts must clamp options.effort via clampCodexEffort before turn/start',
    );
  });

  it('turn/start payload sends the clamped codexEffort', () => {
    assert.match(runtimeSrc, /['"]turn\/start['"]/, 'expected a turn/start request in runtime.ts');
    assert.match(
      runtimeSrc,
      /effort:\s*codexEffort/,
      'turn/start payload must send the clamped `codexEffort`',
    );
  });

  it('does NOT forward raw options.effort to Codex (pre-fix bug pattern absent)', () => {
    assert.doesNotMatch(
      runtimeSrc,
      /effort:\s*options\.effort/,
      'runtime.ts must not forward raw options.effort — would leak Opus-only xhigh/max to Codex',
    );
  });
});
