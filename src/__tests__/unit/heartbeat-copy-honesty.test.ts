/**
 * v10 fix — Phase 3 IA closure 2/2: Settings → Assistant 心跳文案诚实化.
 *
 * Pre-fix: `assistant.heartbeatDesc` said "助理每次访问时检查 HEARTBEAT.md"
 * / "the assistant checks HEARTBEAT.md on each visit". "Each visit" / "每次
 * 访问" is ambiguous — readers can interpret it as a background timer
 * that runs while the app is open. The actual mechanic (in
 * `useAssistantTrigger.ts`) is far narrower: heartbeat fires ONCE per
 * empty new chat opened in the assistant workspace, via `autoTrigger`.
 * It does not run when the app is closed, when the user is on another
 * page, or on a periodic schedule.
 *
 * Pre-fix risk: users open the toggle, expect "the assistant will ping
 * me throughout the day", then feel cheated when nothing arrives until
 * they open a new chat. v6 → /settings/tasks page already absorbed all
 * "real timer" responsibility (Phase 3 Step 3 work); the heartbeat
 * description was the last surface still implying scheduler-like
 * semantics from a feature that has none.
 *
 * Post-fix: zh + en `heartbeatDesc` explicitly state (a) the trigger
 * point is "starting a new chat in the assistant workspace" / "在助理
 * 工作区开始新对话时", and (b) it is NOT a background timer / 不是后台
 * 定时任务 — covering both the affirmative and negative half of the
 * honesty contract. This pins the copy so a future "tighten the
 * description" PR can't quietly drift back into ambiguous territory.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ZH = readFileSync(
  path.resolve(__dirname, '../../i18n/zh.ts'),
  'utf-8',
);
const EN = readFileSync(
  path.resolve(__dirname, '../../i18n/en.ts'),
  'utf-8',
);

function extractValue(src: string, key: string): string {
  // Grab the single-quoted value of the key on its line. The i18n
  // bundles are flat key→string objects, so this is robust enough.
  const re = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'((?:[^'\\\\]|\\\\.)*)'`);
  const m = src.match(re);
  if (!m) {
    throw new Error(`could not find i18n key '${key}' in bundle`);
  }
  return m[1];
}

describe('heartbeat description must state both the actual trigger AND that it is not a background timer (v10)', () => {
  it('zh.ts: heartbeatDesc explicitly negates the "background timer" misconception', () => {
    const zhDesc = extractValue(ZH, 'assistant.heartbeatDesc');
    assert.match(
      zhDesc,
      /不是后台定时任务/,
      'zh assistant.heartbeatDesc must contain the literal "不是后台定时任务" — without it the user can keep the misconception that enabling the toggle starts a periodic background scheduler',
    );
  });

  it('zh.ts: heartbeatDesc names the actual trigger event ("新对话" / open a new chat in the workspace)', () => {
    const zhDesc = extractValue(ZH, 'assistant.heartbeatDesc');
    // Affirmative half: must say WHEN it actually fires. Anchor on
    // "新对话" because that is the unambiguous trigger word; "访问"
    // is what the pre-fix copy said and is exactly the ambiguity we
    // are trying to remove.
    assert.match(
      zhDesc,
      /新对话/,
      'zh assistant.heartbeatDesc must reference "新对话" (the specific trigger — opening a new chat in the assistant workspace). The pre-fix wording "每次访问时" left users unsure what counted as a "visit"',
    );
    assert.match(
      zhDesc,
      /助理工作区/,
      'zh assistant.heartbeatDesc must scope the trigger to "助理工作区" — heartbeat does not fire from arbitrary chats elsewhere',
    );
  });

  it('en.ts: heartbeatDesc explicitly negates the "background timer" misconception', () => {
    const enDesc = extractValue(EN, 'assistant.heartbeatDesc');
    assert.match(
      enDesc,
      /not a background timer/i,
      'en assistant.heartbeatDesc must contain the phrase "not a background timer" so the negative half of the contract is on the same page as the toggle',
    );
  });

  it('en.ts: heartbeatDesc names the actual trigger event ("new chat" in the workspace)', () => {
    const enDesc = extractValue(EN, 'assistant.heartbeatDesc');
    assert.match(
      enDesc,
      /new chat/i,
      'en assistant.heartbeatDesc must reference "new chat" — the pre-fix wording "on each visit" was ambiguous about what a visit meant',
    );
    assert.match(
      enDesc,
      /assistant workspace/i,
      'en assistant.heartbeatDesc must scope the trigger to the "assistant workspace" — heartbeat does not fire from arbitrary chats',
    );
  });

  it('zh.ts: heartbeatDesc retains the silence/speak-up semantics so the user knows what to expect after the trigger', () => {
    // The whole point of heartbeat is: silent if nothing to report,
    // speaks up if there is. v10 only changes WHEN it fires — the
    // OUTCOME description should not regress.
    const zhDesc = extractValue(ZH, 'assistant.heartbeatDesc');
    assert.match(
      zhDesc,
      /HEARTBEAT_OK|保持静默/,
      'zh assistant.heartbeatDesc must keep the "stays silent / HEARTBEAT_OK" half so users know what enabled-and-quiet looks like',
    );
    assert.match(
      zhDesc,
      /主动告知|有需要关注/,
      'zh assistant.heartbeatDesc must keep the "speaks up if something needs attention" half',
    );
  });

  it('en.ts: heartbeatDesc retains the silence/speak-up semantics', () => {
    const enDesc = extractValue(EN, 'assistant.heartbeatDesc');
    assert.match(
      enDesc,
      /HEARTBEAT_OK|stays silent/i,
      'en assistant.heartbeatDesc must keep the "stays silent / HEARTBEAT_OK" half',
    );
    assert.match(
      enDesc,
      /speaks up|needs attention/i,
      'en assistant.heartbeatDesc must keep the "speaks up" half',
    );
  });

  it('the title key is unchanged — only the description was tightened', () => {
    // Sanity guard: a future refactor that thinks "heartbeat is
    // misleading, rename to checkin" would need to update this test
    // and re-justify the rename. The honest fix in v10 is copy-only;
    // the term "heartbeat" itself is fine because the actual semantics
    // (silent if nothing wrong) match the medical/server analogy.
    assert.match(
      ZH,
      /'assistant\.heartbeatTitle':\s*'心跳检测'/,
      'zh assistant.heartbeatTitle should remain "心跳检测" — v10 is a description-only fix',
    );
    assert.match(
      EN,
      /'assistant\.heartbeatTitle':\s*'Heartbeat'/,
      'en assistant.heartbeatTitle should remain "Heartbeat" — v10 is a description-only fix',
    );
  });
});
