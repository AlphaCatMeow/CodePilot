/**
 * Phase 2 (2026-06-02) — GitHub #578: after interrupting a running/long task
 * the composer was locked (clicking send did nothing).
 *
 * Root cause was in stopStream: the force-abort safety net was scheduled
 * INSIDE the interrupt fetch's `.finally()`. A hung `/api/chat/interrupt`
 * never settles, so `.finally` never ran, the abort was never scheduled, the
 * stream stayed `phase: 'active'`, and ChatView's `isStreaming` gate
 * (= phase==='active') queued every new message but never dequeued.
 *
 * The fix extracts the control flow into stopStreamWith() and schedules the
 * force-abort FIRST + UNCONDITIONALLY. These tests pin that ordering — the
 * exact regression — without needing the un-injectable module-level streams
 * map. A real-stream behavioural smoke (interrupt → re-send) is left to the
 * Phase 7 packaged ledger.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stopStreamWith } from '@/lib/stream-session-manager';

function makeStream(phase: string) {
  const calls: string[] = [];
  const stream = {
    snapshot: { phase },
    abortController: { abort: () => { calls.push('abort'); } },
  };
  return { stream, calls };
}

describe('stopStreamWith — force-abort is independent of the interrupt request (#578)', () => {
  it('on an active stream: schedules the force-abort AND requests the interrupt', () => {
    const { stream } = makeStream('active');
    const order: string[] = [];
    stopStreamWith(stream, {
      requestInterrupt: () => order.push('interrupt'),
      scheduleForceAbort: () => order.push('schedule'),
    }, 2000);
    assert.deepEqual(order, ['schedule', 'interrupt']);
  });

  it('schedules the force-abort BEFORE the interrupt — never gated behind it (the regression)', () => {
    const { stream } = makeStream('active');
    let scheduled = false;
    let scheduledBeforeInterrupt = false;
    stopStreamWith(stream, {
      requestInterrupt: () => { scheduledBeforeInterrupt = scheduled; },
      scheduleForceAbort: () => { scheduled = true; },
    }, 2000);
    assert.equal(scheduled, true, 'force-abort must be scheduled');
    assert.equal(
      scheduledBeforeInterrupt,
      true,
      'force-abort must be scheduled before the interrupt request, so a hung interrupt cannot strand the stream',
    );
  });

  it('the scheduled force-abort callback aborts when the stream is still active', () => {
    const { stream, calls } = makeStream('active');
    let captured: (() => void) | null = null;
    stopStreamWith(stream, {
      requestInterrupt: () => {},
      scheduleForceAbort: (fn) => { captured = fn; },
    }, 2000);
    if (!captured) throw new Error('expected a scheduled force-abort callback');
    (captured as () => void)();
    assert.deepEqual(calls, ['abort'], 'still-active stream must be aborted when the timer fires');
  });

  it('the force-abort callback does NOT abort if the stream already left active', () => {
    const { stream, calls } = makeStream('active');
    let captured: (() => void) | null = null;
    stopStreamWith(stream, {
      requestInterrupt: () => {},
      scheduleForceAbort: (fn) => { captured = fn; },
    }, 2000);
    if (!captured) throw new Error('expected a scheduled force-abort callback');
    // a graceful interrupt terminated the stream before the timer fired
    stream.snapshot.phase = 'stopped';
    (captured as () => void)();
    assert.deepEqual(calls, [], 'a stream that already terminated must not be re-aborted');
  });

  it('a non-active stream is a no-op (no interrupt, no schedule)', () => {
    const { stream } = makeStream('stopped');
    const order: string[] = [];
    stopStreamWith(stream, {
      requestInterrupt: () => order.push('interrupt'),
      scheduleForceAbort: () => order.push('schedule'),
    }, 2000);
    assert.deepEqual(order, []);
  });

  it('an undefined stream is a safe no-op', () => {
    const order: string[] = [];
    assert.doesNotThrow(() => stopStreamWith(undefined, {
      requestInterrupt: () => order.push('interrupt'),
      scheduleForceAbort: () => order.push('schedule'),
    }, 2000));
    assert.deepEqual(order, []);
  });
});

describe('stopStream wiring — source pins (#578)', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../lib/stream-session-manager.ts'),
    'utf8',
  );
  const block = src.match(/export function stopStream\(sessionId: string\)[\s\S]*?\n\}/)?.[0] ?? '';

  it('stopStream delegates to stopStreamWith', () => {
    assert.ok(block, 'stopStream() must exist');
    assert.match(block, /stopStreamWith\(/);
  });

  it('the force-abort is NOT scheduled inside a .finally() of the interrupt fetch (the regression)', () => {
    assert.doesNotMatch(
      block,
      /\.finally\(/,
      'scheduling the abort in the interrupt fetch .finally() is exactly the #578 hang',
    );
  });

  it('the interrupt fetch is bounded so a hung endpoint cannot leak', () => {
    assert.match(block, /signal:\s*AbortSignal\.timeout\(/);
  });
});
