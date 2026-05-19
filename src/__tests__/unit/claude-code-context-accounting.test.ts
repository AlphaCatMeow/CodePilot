/**
 * Phase 2 — ClaudeCode adapter producer tests.
 *
 * Pins the contract requirement: plain message vs skill-invocation
 * message MUST produce different snapshots (no 假数据).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { produceClaudeCodeAccountingSnapshot } from '../../lib/harness/claude-code-context-accounting';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupWorkspace(opts: {
  claudeMdContent?: string;
  skills?: Record<string, string>;
}): string {
  const ws = mkdtemp('phase2-ws-');
  if (opts.claudeMdContent !== undefined) {
    fs.writeFileSync(path.join(ws, 'CLAUDE.md'), opts.claudeMdContent);
  }
  if (opts.skills) {
    const skillsDir = path.join(ws, '.claude', 'skills');
    for (const [name, content] of Object.entries(opts.skills)) {
      const dir = path.join(skillsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
    }
  }
  return ws;
}

describe('produceClaudeCodeAccountingSnapshot — Phase 2 ClaudeCode adapter', () => {
  it('plain "你好" message: skills entry omitted, rules from CLAUDE.md if present', () => {
    const ws = setupWorkspace({
      claudeMdContent: 'CodePilot project rules: do X, Y, Z.',
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '你好',
    });

    // No slash command → skills omitted (UI hide via hideZero default)
    assert.equal(snap.entries.skills, undefined);

    // CLAUDE.md exists → rules entry with workspace source
    assert.ok(snap.entries.rules);
    assert.ok(snap.entries.rules.tokens > 0);
    assert.equal(snap.entries.rules.source, 'workspace/CLAUDE.md');

    // Phase 2 unsupported list pinned
    assert.deepEqual([...snap.unsupported].sort(), [
      'files_attachments',
      'mcp',
      'memory',
      'system_prompt',
      'tools',
    ]);

    assert.equal(snap.producedBy, 'claude_code');
  });

  it('"/humanizer-zh xxx" message: skills entry present with SKILL.md filesize', () => {
    const skillBody = '# Humanizer ZH\n\nRewrite AI-generated Chinese to read more naturally...';
    const ws = setupWorkspace({
      skills: { 'humanizer-zh': skillBody },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '/humanizer-zh 改写这段文本',
    });

    assert.ok(snap.entries.skills);
    assert.ok(snap.entries.skills.tokens > 0);
    // tokens === ceil(skillBody.length / 4)
    assert.equal(
      snap.entries.skills.tokens,
      Math.ceil(skillBody.length / 4),
    );
    assert.equal(
      snap.entries.skills.source,
      'workspace/.claude/skills/humanizer-zh/SKILL.md',
    );
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');
  });

  it('plain vs skill message produce DIFFERENT snapshots (user verify requirement)', () => {
    const ws = setupWorkspace({
      claudeMdContent: 'rules',
      skills: { 'humanizer-zh': 'skill body content here for testing' },
    });
    const plain = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '你好',
    });
    const invoked = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '/humanizer-zh 改写',
    });

    // Plain has no skills entry
    assert.equal(plain.entries.skills, undefined);
    // Invoked has skills entry
    assert.ok(invoked.entries.skills);
    assert.ok(invoked.entries.skills.tokens > 0);

    // Same rules data (CLAUDE.md unchanged)
    assert.equal(plain.entries.rules?.tokens, invoked.entries.rules?.tokens);
  });

  it('slash command without matching skill file: skills entry omitted (not fake)', () => {
    const ws = setupWorkspace({});
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '/no-such-skill xxx',
    });
    assert.equal(snap.entries.skills, undefined);
  });

  it('workspace without CLAUDE.md: rules entry omitted', () => {
    const ws = setupWorkspace({});
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: 'hi',
    });
    assert.equal(snap.entries.rules, undefined);
  });

  it('source breadcrumb format pins "workspace/.../" prefix for traceability', () => {
    const ws = setupWorkspace({
      claudeMdContent: 'rules',
      skills: { 'humanizer-zh': 'skill body' },
    });
    const snap = produceClaudeCodeAccountingSnapshot({
      workspacePath: ws,
      userPrompt: '/humanizer-zh ',
    });
    assert.ok(snap.entries.skills?.source.startsWith('workspace/.claude/skills/'));
    assert.ok(snap.entries.rules?.source.startsWith('workspace/'));
  });
});
