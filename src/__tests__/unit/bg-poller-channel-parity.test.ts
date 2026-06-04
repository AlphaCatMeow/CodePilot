/**
 * P1 fix (v6): the Electron bg-poller MUST ack the same `electron-native`
 * row that `sendNotification` pre-wrote when the window-visible
 * renderer would have ack'd it. The pre-fix bg-poller introduced a
 * separate `electron-bg-native` channel, leaving the `electron-native`
 * row stuck in `queued` forever and the in-app `renderer-toast` row
 * also stuck (because the queue had been drained by bg-poller, not
 * the renderer). The delivery log lied: said "queued" when the user
 * had already seen the OS notification.
 *
 * Source-grep contract — runtime IPC + Notification can't be exercised
 * from Node, but we can lock the structural shape:
 *
 *   1. The bg-poller block in `electron/main.ts` MUST ack channel
 *      `'electron-native'` (not `'electron-bg-native'`) on success.
 *   2. The bg-poller block MUST also ack `'renderer-toast'` with
 *      status `'skipped'` so the row written at enqueue time doesn't
 *      stay queued forever after bg drain consumed the queue.
 *   3. The forbidden `'electron-bg-native'` literal must NOT appear
 *      anywhere in `electron/main.ts` (the previous bug's name is
 *      retired so nobody re-introduces it by accident).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAIN = readFileSync(
  path.resolve(__dirname, '../../../electron/main.ts'),
  'utf-8',
);

describe('Electron bg-poller channel parity (Phase 3 Step 3 v6 P1 fix)', () => {
  it('bg-poller acks electron-native (not electron-bg-native)', () => {
    // Locate the bg-notify-poll function body.
    const block = MAIN.match(/function startBgNotifyPoll[\s\S]*?\n\}/);
    assert.ok(block, 'startBgNotifyPoll body not found');
    const body = block![0];
    assert.match(
      body,
      /channel:\s*['"]electron-native['"][\s\S]{0,80}status:\s*['"]delivered['"]/,
      'bg-poller success path must ack channel="electron-native" status="delivered" — that is the same row sendNotification pre-wrote',
    );
    assert.match(
      body,
      /channel:\s*['"]electron-native['"][\s\S]{0,80}status:\s*['"]error['"]/,
      'bg-poller failure path must ack channel="electron-native" status="error" too',
    );
  });

  it('bg-poller marks renderer-toast as skipped after consuming the queue', () => {
    const block = MAIN.match(/function startBgNotifyPoll[\s\S]*?\n\}/);
    assert.ok(block);
    const body = block![0];
    assert.match(
      body,
      /channel:\s*['"]renderer-toast['"][\s\S]{0,120}status:\s*['"]skipped['"]/,
      'bg-poller must mark the renderer-toast candidate as skipped after a hidden-window delivery — otherwise the row stays queued forever (the queue was drained, the renderer will never see it)',
    );
  });

  it('the forbidden electron-bg-native channel is no longer used', () => {
    assert.doesNotMatch(
      MAIN,
      /['"]electron-bg-native['"]/,
      'electron-bg-native is the retired pre-v6 channel name. Use electron-native (the same channel sendNotification pre-writes) so renderer + bg paths converge on one row.',
    );
  });

  it('canonical NotificationChannel type does not list electron-bg-native (v7 P3)', () => {
    // Type-layer cleanup. Leaving the literal in the union would let
    // a regression silently re-introduce the bad channel name with
    // full TypeScript blessing.
    const types = readFileSync(
      path.resolve(__dirname, '../../types/index.ts'),
      'utf-8',
    );
    const channelUnion = types.match(/export\s+type\s+NotificationChannel\b[\s\S]*?;/);
    assert.ok(channelUnion, 'NotificationChannel type union not found in types/index.ts');
    assert.doesNotMatch(
      channelUnion![0],
      /['"]electron-bg-native['"]/,
      'NotificationChannel must NOT include electron-bg-native — that name is permanently retired (v7 P3)',
    );
  });

  it('no runtime code under src/ references the retired channel literal (v7 P3)', () => {
    // Broader grep across src/. Comment lines that explain WHY the
    // name is retired are allowed (and useful documentation). This
    // test is the safety net catching a future code path that adds
    // 'electron-bg-native' as a string literal anywhere.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    const SRC = path.resolve(__dirname, '../..');
    const offenders: { rel: string; line: number; text: string }[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          if (full === __filename) continue;
          const lines = fs.readFileSync(full, 'utf-8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            // Skip pure comment lines — JSDoc / `// …` rationale is
            // legitimate documentation of the retirement.
            if (/^\s*(\/\/|\*\s|\/\*)/.test(lines[i])) continue;
            if (/['"]electron-bg-native['"]/.test(lines[i])) {
              offenders.push({
                rel: path.relative(SRC, full),
                line: i + 1,
                text: lines[i].trim().slice(0, 120),
              });
            }
          }
        }
      }
    }
    walk(SRC);
    if (offenders.length > 0) {
      const detail = offenders.map((o) => `  ${o.rel}:${o.line} → ${o.text}`).join('\n');
      assert.fail(
        `Found ${offenders.length} runtime reference(s) to 'electron-bg-native'. ` +
          `That channel name is retired — use 'electron-native' for both window-visible and ` +
          `window-hidden paths so delivery log stays consistent.\nOffenders:\n${detail}`,
      );
    }
  });
});
