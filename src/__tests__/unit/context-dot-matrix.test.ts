/**
 * ContextDotMatrix.computeAllocations regression tests.
 *
 * Pins the v8 fix (2026-05-20): mini-bar (cellCount=10, minCellsPerKind=0)
 * must NOT inflate non-zero categories to 1 cell each. User reported "50%
 * 上下文占用时点阵就已经全满" — root cause was Math.max(1, ceil) forcing
 * every small category to take 1 cell out of only 10.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAllocations } from '../../components/chat/context-breakdown/ContextDotMatrix';
import type { ContextUsageBreakdown } from '../../lib/context-breakdown';
// Suppress unused import warning — ContextUsageBreakdown is referenced in
// tests via `as ContextUsageBreakdown['parts']` casts.

function makeBreakdown(parts: Array<{ kind: string; tokens: number }>, contextWindow = 200000): ContextUsageBreakdown {
  return {
    parts: parts.map((p) => ({ ...p, label: p.kind, source: 'test' })) as ContextUsageBreakdown['parts'],
    usedTokens: parts.reduce((s, p) => s + p.tokens, 0),
    contextWindow,
  } as ContextUsageBreakdown;
}

describe('ContextDotMatrix.computeAllocations — minCellsPerKind: 0 (mini-bar)', () => {
  it('5 tiny categories at ~2% each on 10-cell bar → most disappear (no force-1), bar reflects ~10% real fill', () => {
    // 5 categories × 2% = 10% total used. With minCellsPerKind=1 (old behavior),
    // this would assign 5 cells (50% fill). With minCellsPerKind=0, each rounds
    // to round(0.2) = 0 cell, so they vanish; total fill = 0–1 cells.
    const breakdown = makeBreakdown(
      [
        { kind: 'tools', tokens: 4000 },
        { kind: 'mcp', tokens: 4000 },
        { kind: 'skills', tokens: 4000 },
        { kind: 'rules', tokens: 4000 },
        { kind: 'system_prompt', tokens: 4000 },
      ],
      200_000,
    );
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.ok(filled <= 2, `mini-bar should reflect ~10% real fill, got ${filled} filled cells (${cells.length} categories)`);
    assert.equal(filled + emptyCells, 10);
  });

  it('1 category at 50% on 10-cell bar → exactly 5 filled cells', () => {
    const breakdown = makeBreakdown(
      [{ kind: 'conversation', tokens: 100_000 }],
      200_000,
    );
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.equal(filled, 5);
    assert.equal(emptyCells, 5);
  });

  it('1 category at 0.4% on 10-cell bar → boosted to 1 cell (any usage visible, user feedback 2026-05-20)', () => {
    // Updated 2026-05-20: previously this returned 0 cells because round(0.04) = 0.
    // User reported Codex at ~1% real usage on 10-cell mini-bar showed "0 dots"
    // — confusing because they JUST sent a message but mini-bar looks empty.
    // New behavior: when used > 0 but everything rounds below 0.5, boost the
    // largest non-pending category to 1 cell as a "some usage exists" marker.
    const breakdown = makeBreakdown(
      [{ kind: 'rules', tokens: 800 }],
      200_000,
    );
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].kind, 'rules');
    assert.equal(cells[0].cells, 1);
    assert.equal(emptyCells, 9);
  });

  it('Codex 1% scenario regression: 3 categories at < 1% on 10-cell bar → boosted, exactly 1 cell on largest', () => {
    // Real-world: Codex used 2.8K / 258K (1.1%) split tools 2.1K / conversation 601 / rules 93.
    // Without boost: all round to 0, mini-bar fully empty (user complaint).
    // With boost: largest (tools) gets 1 cell.
    const breakdown = makeBreakdown(
      [
        { kind: 'tools', tokens: 2100 },
        { kind: 'conversation', tokens: 601 },
        { kind: 'rules', tokens: 93 },
      ],
      258_400,
    );
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].kind, 'tools', 'largest category hosts the indicator cell');
    assert.equal(cells[0].cells, 1);
    assert.equal(emptyCells, 9);
  });

  it('Native unknown contextWindow on 10-cell bar → uses 200K fallback, NOT used-as-denominator (mini-bar does not show 100% fill at 3.5K real usage)', () => {
    // Real-world: Native (agent-loop+OpenRouter) often has no contextWindow
    // from upstream. Old behavior: denominator = usedTokens, so 100% fill
    // even at 3.5K real usage — misleading "context maxed out" (user
    // complaint 2026-05-20).
    // New: when window unknown + mini-bar (minCellsPerKind=0), denominator
    // falls back to 200K (typical chat-LLM window). 3.5K / 200K = 1.75%
    // → cells round to 0 → boost rule gives largest 1 cell.
    const breakdown: ContextUsageBreakdown = {
      parts: [
        { kind: 'tools', tokens: 813, label: 'tools', source: 'test' },
        { kind: 'rules', tokens: 93, label: 'rules', source: 'test' },
        { kind: 'conversation', tokens: 2552, label: 'conversation', source: 'test' },
      ] as ContextUsageBreakdown['parts'],
      usedTokens: 813 + 93 + 2552,
      contextWindow: undefined,  // ← unknown
    } as ContextUsageBreakdown;
    const { cells, emptyCells } = computeAllocations(breakdown, 10, 0);
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.ok(filled <= 2, `mini-bar with unknown window @ 3.5K must NOT fill 10/10; got ${filled} cells (${cells.length} categories)`);
    assert.ok(filled >= 1, 'mini-bar must show at least 1 cell when used > 0 (any-usage marker)');
    assert.equal(filled + emptyCells, 10);
  });

  it('popover unknown contextWindow (minCellsPerKind=1) still uses used-as-denominator (legend matches bar)', () => {
    // Popover (100-cell, minCellsPerKind=1) keeps old behavior: when window
    // unknown, distribute by used so the breakdown legend matches the bar
    // one-to-one. "容量未知" header tells the user this is breakdown not %.
    const breakdown: ContextUsageBreakdown = {
      parts: [
        { kind: 'tools', tokens: 813, label: 'tools', source: 'test' },
        { kind: 'conversation', tokens: 2552, label: 'conversation', source: 'test' },
      ] as ContextUsageBreakdown['parts'],
      usedTokens: 813 + 2552,
      contextWindow: undefined,
    } as ContextUsageBreakdown;
    const { cells, emptyCells } = computeAllocations(breakdown, 100, 1);
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.equal(filled, 100, 'popover at unknown window distributes used across all cells');
    assert.equal(emptyCells, 0);
  });
});

describe('ContextDotMatrix.computeAllocations — minCellsPerKind: 1 (popover default, unchanged)', () => {
  it('5 tiny categories at ~2% on 100-cell popover → each surfaces 1 cell minimum', () => {
    const breakdown = makeBreakdown(
      [
        { kind: 'tools', tokens: 4000 },
        { kind: 'mcp', tokens: 4000 },
        { kind: 'skills', tokens: 4000 },
        { kind: 'rules', tokens: 4000 },
        { kind: 'system_prompt', tokens: 4000 },
      ],
      200_000,
    );
    const { cells } = computeAllocations(breakdown, 100, 1);
    // Each category should have at least 1 cell (legend match)
    for (const cell of cells) {
      assert.ok(cell.cells >= 1, `${cell.kind} got ${cell.cells} cells, expected ≥ 1 with minCellsPerKind=1`);
    }
    // 4000 / 200000 * 100 = 2 → ceil = 2 cells each
    const filled = cells.reduce((s, c) => s + c.cells, 0);
    assert.equal(filled, 10); // 5 × 2 = 10 cells out of 100
  });

  it('1 category at 0.4% on 100-cell popover → 1 cell (Math.max(1, ceil) kicks in)', () => {
    const breakdown = makeBreakdown(
      [{ kind: 'rules', tokens: 800 }],
      200_000,
    );
    const { cells } = computeAllocations(breakdown, 100, 1);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].cells, 1);
  });
});
