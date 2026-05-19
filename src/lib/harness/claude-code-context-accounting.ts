/**
 * Phase 2 — ClaudeCode Runtime's Context Accounting producer.
 *
 * Source-Of-Truth POC (2026-05-20) — SDK type inspection in
 * `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:
 *
 *   - SDKSystemMessage.skills: string[]     — AVAILABLE skill names (every-turn list)
 *   - SDKSystemMessage.tools: string[]      — AVAILABLE tool names (no schemas)
 *   - SDKSystemMessage.mcp_servers: {...}[] — AVAILABLE MCP servers (no schemas)
 *   - SDKAssistantMessage.message: BetaMessage — content blocks incl. tool_use
 *
 * The SDK does NOT expose per-turn "invoked skill" metadata. Claude Code
 * loads skills via slash-command in the user prompt (`/<skill-name>`),
 * and the SDK doesn't echo back which skill markdown got inlined. Per
 * user verify spec: "available skills ≠ invoked skills", so we don't
 * count available lists as real entries — we scan the user prompt for
 * the slash command and read the corresponding `SKILL.md` from disk.
 *
 * Phase 2 real-source coverage (vs Phase 6 Tier 2 假数据):
 *   - skills:   ✅ slash-command scan + workspace/.claude/skills/<name>/SKILL.md filesize
 *   - rules:    ✅ workspace CLAUDE.md filesize
 *   - tools:    ❌ unsupported (SDK doesn't expose tool schema sizes)
 *   - mcp:      ❌ unsupported (SDK doesn't expose MCP tool schema sizes)
 *   - memory:   ❌ unsupported (adapter doesn't pass assistantMemory yet)
 *   - system_prompt: ❌ unsupported (full SDK preset is opaque from our side;
 *                       only our adapter `append` is visible, partial counting
 *                       would be misleading)
 *   - files_attachments: ❌ unsupported (composer pending wire handles this
 *                              via ContextBreakdownInputs.pending, not via
 *                              the Runtime adapter path)
 *
 * Entries omit (vs `unsupported` list) — semantic distinction:
 *   - omit: "this turn didn't trigger the kind" (e.g. plain "你好" → no
 *     skill omit → UI hides via hideZero default)
 *   - unsupported: "Runtime CAN'T measure this kind, ever" (permanent
 *     declaration; UI hides regardless of value)
 *
 * Bumping a kind from unsupported → real entry is a future-Phase
 * extension (e.g. when SDK adds per-turn loaded-skill metadata, or when
 * we wire MCP tool schemas).
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ContextAccountingEntry,
  ContextAccountingKind,
  RuntimeContextAccountingSnapshot,
} from '@/types';

const PHASE_2_UNSUPPORTED: readonly ContextAccountingKind[] = [
  'tools',
  'mcp',
  'memory',
  'system_prompt',
  'files_attachments',
] as const;

/** Token estimator — same char/4 heuristic the compiler uses. */
function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/** Match a leading slash command — `/skill-name args...`. Permits
 *  whitespace and matches the first `/<word>` token only. */
const SLASH_COMMAND_RE = /^\s*\/([a-z0-9_-]+)/i;

/**
 * Phase 2 ClaudeCode producer.
 *
 * Inputs are the same shape adaptForClaudeCode receives, plus the user
 * prompt (which adapter doesn't usually surface but is the only signal
 * we have for "invoked skill"). All filesystem reads are best-effort —
 * missing files mean "no real source" and the kind is omitted from
 * entries, NOT silently substituted.
 */
export function produceClaudeCodeAccountingSnapshot(input: {
  workspacePath: string;
  userPrompt: string;
}): RuntimeContextAccountingSnapshot {
  const entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>> = {};

  // -- skills (slash command + SKILL.md filesize) --
  const skillMatch = input.userPrompt.match(SLASH_COMMAND_RE);
  if (skillMatch) {
    const skillName = skillMatch[1];
    const skillPath = path.join(
      input.workspacePath,
      '.claude',
      'skills',
      skillName,
      'SKILL.md',
    );
    try {
      const stat = fs.statSync(skillPath);
      entries.skills = {
        tokens: estimateTokensFromBytes(stat.size),
        source: `workspace/.claude/skills/${skillName}/SKILL.md`,
        detail: skillName,
      };
    } catch {
      // skill file not present — entries.skills omitted (UI hides)
    }
  }

  // -- rules (workspace CLAUDE.md filesize) --
  const claudeMdPath = path.join(input.workspacePath, 'CLAUDE.md');
  try {
    const stat = fs.statSync(claudeMdPath);
    entries.rules = {
      tokens: estimateTokensFromBytes(stat.size),
      source: 'workspace/CLAUDE.md',
      detail: 'CLAUDE.md',
    };
  } catch {
    // CLAUDE.md missing — entries.rules omitted (UI hides)
  }

  return {
    entries,
    unsupported: [...PHASE_2_UNSUPPORTED],
    producedBy: 'claude_code',
  };
}
