/**
 * Unit tests for the Run Checkpoint trust-layer builder.
 *
 * Coverage: all five active reasons (no-compatible-provider /
 * pinned-invalid / runtime-fallback from Round 1; context-cost-change
 * and permission-elevation from Round 2) plus the precedence rule
 * (no-provider supersedes the others, since "your pin is wrong" is
 * meaningless when there's no provider to send to in the first place).
 *
 * Run with: npx tsx --test src/__tests__/unit/run-checkpoint.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCheckpoints,
  shouldTriggerContextCost,
  CONTEXT_COST_PENDING_HARD,
  type BuildCheckpointsOpts,
} from '../../lib/run-checkpoint';

const ok: BuildCheckpointsOpts = {
  noCompatibleProvider: false,
  defaultInvalid: false,
  runtimeFallback: false,
};

describe('buildCheckpoints — happy path', () => {
  it('returns [] when nothing is wrong', () => {
    assert.deepEqual(buildCheckpoints(ok), []);
  });
});

describe('buildCheckpoints — no-compatible-provider precedence', () => {
  it('emits only the no-provider reason even if other flags are set', () => {
    const out = buildCheckpoints({
      noCompatibleProvider: true,
      defaultInvalid: true,
      runtimeFallback: true,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'no-compatible-provider');
    assert.equal(out[0].tone, 'error');
    assert.equal(out[0].action?.href, '/settings/providers');
  });

  it('uses the providers settings route, not runtime, for the action', () => {
    const out = buildCheckpoints({ ...ok, noCompatibleProvider: true });
    assert.equal(out[0].action?.href, '/settings/providers');
  });
});

describe('buildCheckpoints — pinned-invalid', () => {
  it('emits the pinned-invalid reason when defaultInvalid is true', () => {
    const out = buildCheckpoints({ ...ok, defaultInvalid: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'pinned-invalid');
    assert.equal(out[0].tone, 'error');
    assert.equal(out[0].action?.href, '/settings/runtime');
  });

  it('renders a {pinned} placeholder when no descriptor is provided', () => {
    const out = buildCheckpoints({ ...ok, defaultInvalid: true });
    assert.equal(out[0].descriptionValues?.pinned, '?');
  });

  it('passes the supplied descriptor through to the description', () => {
    const out = buildCheckpoints({
      ...ok,
      defaultInvalid: true,
      pinnedDescriptor: 'Anthropic / sonnet-4-5',
    });
    assert.equal(out[0].descriptionValues?.pinned, 'Anthropic / sonnet-4-5');
  });
});

describe('buildCheckpoints — runtime-fallback', () => {
  it('emits the runtime-fallback reason as warning, not error', () => {
    const out = buildCheckpoints({ ...ok, runtimeFallback: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'runtime-fallback');
    assert.equal(out[0].tone, 'warning');
    assert.equal(out[0].action?.href, '/settings/runtime');
  });
});

describe('buildCheckpoints — stacking', () => {
  it('stacks pinned-invalid + runtime-fallback when both apply', () => {
    const out = buildCheckpoints({
      ...ok,
      defaultInvalid: true,
      runtimeFallback: true,
      pinnedDescriptor: 'OpenRouter / gpt-5',
    });
    assert.equal(out.length, 2);
    // Pinned first (more blocking), runtime fallback after.
    assert.equal(out[0].id, 'pinned-invalid');
    assert.equal(out[1].id, 'runtime-fallback');
  });
});

describe('buildCheckpoints — Round 1 + 2 scope guard', () => {
  // The active reason set is exactly the five below. If a future
  // commit adds `dangerous-tool-call` (Round 3) — or any new id — to
  // the builder, this test will fail and force the author to confirm
  // the new round has been formally started (plan + i18n + state
  // wiring + e2e all in place).
  it('only emits the five known reason ids', () => {
    const seen = new Set<string>();
    for (const opts of [
      { ...ok, noCompatibleProvider: true },
      { ...ok, defaultInvalid: true },
      { ...ok, runtimeFallback: true },
      { ...ok, defaultInvalid: true, runtimeFallback: true },
      { ...ok, pendingContextTokens: 50_000, usedContextTokens: 0 },
      { ...ok, permissionElevationPending: true },
    ]) {
      for (const r of buildCheckpoints(opts)) {
        seen.add(r.id);
      }
    }
    assert.deepEqual(
      [...seen].sort(),
      [
        'context-cost-change',
        'no-compatible-provider',
        'permission-elevation',
        'pinned-invalid',
        'runtime-fallback',
      ].sort(),
    );
  });

  it('every reason has exactly one action — single-action plan §B', () => {
    for (const opts of [
      { ...ok, noCompatibleProvider: true },
      { ...ok, defaultInvalid: true },
      { ...ok, runtimeFallback: true },
      { ...ok, pendingContextTokens: 12_000, usedContextTokens: 0 },
      { ...ok, permissionElevationPending: true },
    ]) {
      for (const r of buildCheckpoints(opts)) {
        assert.ok(r.action, `${r.id} must have an action`);
        // Action must be either a navigation (href + actionId)
        // or a confirm action (actionId only, no href).
        assert.ok(
          r.action?.href || r.action?.onClick || r.action?.actionId,
          `${r.id} must have href / onClick / actionId`,
        );
      }
    }
  });
});

// ─── Round 2 — context-cost-change ──────────────────────────────────

describe('shouldTriggerContextCost', () => {
  it('returns true when pending crosses the hard 10K cap regardless of used', () => {
    assert.equal(shouldTriggerContextCost(CONTEXT_COST_PENDING_HARD, 0), true);
    assert.equal(shouldTriggerContextCost(15_000, 1_000_000), true);
  });

  it('returns false when pending is below 10K AND used is 0', () => {
    assert.equal(shouldTriggerContextCost(0, 0), false);
    assert.equal(shouldTriggerContextCost(9_999, 0), false);
  });

  it('returns true when pending / used >= 30% (with used > 0)', () => {
    assert.equal(shouldTriggerContextCost(3_000, 10_000), true);  // 30% exact
    assert.equal(shouldTriggerContextCost(5_000, 10_000), true);  // 50%
  });

  it('returns false when pending / used < 30%', () => {
    assert.equal(shouldTriggerContextCost(2_999, 10_000), false); // 29.99%
    assert.equal(shouldTriggerContextCost(1_000, 10_000), false); // 10%
  });

  it('the 10K hard cap takes precedence over the ratio for tiny used', () => {
    // pending=10K, used=1 → ratio is huge but hard-cap fires first
    assert.equal(shouldTriggerContextCost(10_000, 1), true);
  });
});

describe('buildCheckpoints — context-cost-change reason', () => {
  it('emits an info-toned reason with requiresConfirm=true', () => {
    const reasons = buildCheckpoints({ ...ok, pendingContextTokens: 12_000, usedContextTokens: 0 });
    const r = reasons.find((x) => x.id === 'context-cost-change');
    assert.ok(r, 'context-cost reason should fire');
    assert.equal(r!.tone, 'info');
    assert.equal(r!.requiresConfirm, true);
    assert.equal(r!.action?.actionId, 'confirm-context-cost');
    // descriptionValues carries human-formatted token counts
    assert.equal(r!.descriptionValues?.pending, '12K');
    assert.equal(r!.descriptionValues?.used, '0');
  });

  it('does NOT emit when below trigger thresholds', () => {
    const reasons = buildCheckpoints({ ...ok, pendingContextTokens: 5_000, usedContextTokens: 0 });
    assert.equal(reasons.find((x) => x.id === 'context-cost-change'), undefined);
  });

  it('formats large used counts in K', () => {
    const reasons = buildCheckpoints({ ...ok, pendingContextTokens: 3_500, usedContextTokens: 10_000 });
    const r = reasons.find((x) => x.id === 'context-cost-change')!;
    assert.equal(r.descriptionValues?.used, '10K');
  });
});

// ─── Round 2 — permission-elevation ─────────────────────────────────

describe('buildCheckpoints — permission-elevation reason', () => {
  it('emits a warning-toned reason with requiresConfirm=true when permissionElevationPending', () => {
    const reasons = buildCheckpoints({ ...ok, permissionElevationPending: true });
    const r = reasons.find((x) => x.id === 'permission-elevation');
    assert.ok(r, 'permission-elevation reason should fire');
    assert.equal(r!.tone, 'warning');
    assert.equal(r!.requiresConfirm, true);
    assert.equal(r!.action?.actionId, 'confirm-permission-elevation');
  });

  it('does NOT emit when permissionElevationPending=false', () => {
    const reasons = buildCheckpoints({ ...ok, permissionElevationPending: false });
    assert.equal(reasons.find((x) => x.id === 'permission-elevation'), undefined);
  });

  it('does NOT emit when permissionElevationPending omitted (default false)', () => {
    const reasons = buildCheckpoints({ ...ok });
    assert.equal(reasons.find((x) => x.id === 'permission-elevation'), undefined);
  });
});

// ─── Round 2 — stacking with Round 1 ────────────────────────────────

describe('buildCheckpoints — Round 1 + 2 stacking', () => {
  it('runtime-fallback + context-cost + permission-elevation all stack together', () => {
    const reasons = buildCheckpoints({
      ...ok,
      runtimeFallback: true,
      pendingContextTokens: 12_000,
      usedContextTokens: 0,
      permissionElevationPending: true,
    });
    const ids = reasons.map((r) => r.id);
    assert.ok(ids.includes('runtime-fallback'));
    assert.ok(ids.includes('context-cost-change'));
    assert.ok(ids.includes('permission-elevation'));
  });

  it('no-compatible-provider still suppresses Round 2 reasons (precedence)', () => {
    const reasons = buildCheckpoints({
      ...ok,
      noCompatibleProvider: true,
      pendingContextTokens: 50_000,
      permissionElevationPending: true,
    });
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0].id, 'no-compatible-provider');
  });
});
