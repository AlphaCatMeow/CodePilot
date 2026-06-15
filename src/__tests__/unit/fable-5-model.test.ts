/**
 * Fable 5 接入回归 (2026-06-10) — 模式沿用 opus-4-8-sonnet-4-6.test.ts。
 *
 * Fable 5 (claude-fable-5) 是 Opus 之上的新档位，与 Opus 4.7/4.8 共享
 * adaptive-thinking 请求契约（无手动 extended thinking；1M 默认上下文；
 * 采样参数移除），并多一条 breaking change：**思考完全关不掉**。官方迁移
 * 指南原文："thinking: {type: 'disabled'} returns an error. On Claude
 * Opus 4.8, requests without a thinking field run without thinking; on
 * claude-fable-5, those requests run with adaptive thinking." 所以省略
 * 参数只是 wire 合法，语义上思考仍然开启 —— sanitizer 必须用
 * thinkingForcedOn 标志让两条 runtime 路径显式告知用户（Codex review
 * P1, 2026-06-10：第一版只省略不告知，把静默语义替换钉成了预期，已修正）。
 *
 * 依据：Anthropic 官方模型文档（claude-api skill 缓存 2026-05-26）：
 * id=claude-fable-5, context=1M, max output=128K, $10/$50 per MTok,
 * effort low→max（含 xhigh）, adaptive thinking only。
 * 不接入 OpenRouter slug —— 仓库纪律要求显式 fixture，slug 未经验证。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  sanitizeClaudeModelOptions,
  isOpusAdaptiveThinkingModel,
  isFableModel,
} from '../../lib/claude-model-options';
import { getContextWindow } from '../../lib/model-context';

const LIB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../lib');
const read = (f: string) => fs.readFileSync(path.join(LIB, f), 'utf8');

describe('Fable 5 — adaptive-thinking family detection', () => {
  it('detects fable-5 in upstream / short / tagged forms', () => {
    assert.equal(isFableModel('claude-fable-5'), true);
    assert.equal(isFableModel('fable-5'), true);
    assert.equal(isFableModel('claude-fable-5[1m]'), true);
    assert.equal(isFableModel('claude-opus-4-8'), false);
    assert.equal(isFableModel(undefined), false);
  });

  it('fable-5 joins the 4.7+ family guard (enabled→adaptive, no 1m beta)', () => {
    assert.equal(isOpusAdaptiveThinkingModel('claude-fable-5'), true);
    // existing family members unaffected
    assert.equal(isOpusAdaptiveThinkingModel('claude-opus-4-7'), true);
    assert.equal(isOpusAdaptiveThinkingModel('claude-sonnet-4-6'), false);
  });
});

describe('Fable 5 — request param guards', () => {
  it('manual extended thinking → adaptive/summarized; 1M default (no beta header)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-fable-5',
      thinking: { type: 'enabled', budgetTokens: 10000 },
      context1m: true,
    });
    assert.deepEqual(out.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(out.applyContext1mBeta, false);
    assert.equal(out.isOpusAdaptiveThinking, true);
  });

  it("thinking:'disabled' on Fable 5: param omitted (avoids 400) AND flagged thinkingForcedOn — omission is NOT 'thinking off'", () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-fable-5',
      thinking: { type: 'disabled' },
    });
    assert.equal(out.thinking, undefined);
    assert.equal(out.thinkingForcedOn, true,
      'callers must be told the "thinking off" choice cannot be honored — adaptive thinking runs anyway');
  });

  it("thinking:'disabled' is NOT regressed on Opus 4.8 (accepted there; no forced-on flag)", () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-opus-4-8',
      thinking: { type: 'disabled' },
    });
    assert.deepEqual(out.thinking, { type: 'disabled' });
    assert.equal(out.thinkingForcedOn, false);
  });

  it('thinkingForcedOn is false on all non-disabled Fable paths', () => {
    assert.equal(sanitizeClaudeModelOptions({
      model: 'claude-fable-5', thinking: { type: 'adaptive' },
    }).thinkingForcedOn, false);
    assert.equal(sanitizeClaudeModelOptions({
      model: 'claude-fable-5',
    }).thinkingForcedOn, false);
  });

  it('adaptive without display gets summarized (reasoning UI stays visible)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-fable-5',
      thinking: { type: 'adaptive' },
    });
    assert.deepEqual(out.thinking, { type: 'adaptive', display: 'summarized' });
  });
});

describe('Fable 5 — context window', () => {
  it('claude-fable-5 resolves to 1M (exact + via upstream option)', () => {
    assert.equal(getContextWindow('claude-fable-5'), 1_000_000);
    assert.equal(
      getContextWindow('fable-5', { upstream: 'claude-fable-5' }),
      1_000_000,
    );
  });
});

describe('Fable 5 — catalog / resolver source pins', () => {
  it('first-party Anthropic catalog ships fable-5 with concrete upstream and NO role', () => {
    const src = read('provider-catalog.ts');
    assert.match(src, /modelId: 'fable-5'/, 'catalog must contain fable-5');
    assert.match(src, /upstreamModelId: 'claude-fable-5'/);
    // No role: — fable-5 must be an explicit pick, not a silent default
    // switch (same policy as opus-4-8; pinned-default is a hard promise).
    const entry = src.slice(src.indexOf("modelId: 'fable-5'"), src.indexOf("modelId: 'fable-5'") + 700);
    assert.doesNotMatch(entry.split('},')[0] + entry.split('},')[1], /\brole:/,
      'fable-5 must not claim a role alias');
  });

  it('env-mode alias table (shared ENV_CLAUDE_CODE_MODELS) ships fable-5 → claude-fable-5; resolver derives', () => {
    // 2026-06-10 consolidation (Codex P1): the resolver no longer inlines
    // its own envModels copy — it derives from provider-catalog's
    // ENV_CLAUDE_CODE_MODELS. Content is pinned in
    // env-models-single-source.test.ts; here we pin the derivation.
    const src = read('provider-resolver.ts');
    assert.match(src, /=\s*ENV_CLAUDE_CODE_MODELS/,
      'provider-resolver envModels must derive from the shared export');
  });

  it('OpenRouter catalog intentionally has NO fable entry (slug unverified)', () => {
    const src = read('provider-catalog.ts');
    const orStart = src.indexOf('OPENROUTER_ANTHROPIC_MODELS');
    const orEnd = src.indexOf('ANTHROPIC_FIRST_PARTY_MODELS');
    assert.ok(!src.slice(orStart, orEnd).includes('fable'),
      'do not add an OpenRouter fable slug without an explicit verified fixture');
  });
});

describe('Fable 5 — thinkingForcedOn surfacing (Codex P1 closeout)', () => {
  it('native runtime (agent-loop) emits THINKING_ALWAYS_ON when the flag fires', () => {
    const src = read('agent-loop.ts');
    assert.match(src, /sanitized\.thinkingForcedOn/,
      'agent-loop must consume the thinkingForcedOn flag');
    assert.match(src, /THINKING_ALWAYS_ON/,
      'agent-loop must surface a THINKING_ALWAYS_ON status notification');
  });

  it('SDK runtime (claude-client) emits THINKING_ALWAYS_ON when the flag fires', () => {
    const src = read('claude-client.ts');
    assert.match(src, /sanitized\.thinkingForcedOn/,
      'claude-client must consume the thinkingForcedOn flag');
    assert.match(src, /THINKING_ALWAYS_ON/,
      'claude-client must surface a THINKING_ALWAYS_ON status notification');
  });

  it('THINKING_ALWAYS_ON is whitelisted as a persistent toast code', () => {
    const hooksSrc = fs.readFileSync(
      path.resolve(LIB, '../hooks/useSSEStream.ts'), 'utf8');
    const whitelistStart = hooksSrc.indexOf('TOAST_STATUS_CODES');
    assert.ok(hooksSrc.slice(whitelistStart, whitelistStart + 400).includes('THINKING_ALWAYS_ON'),
      'THINKING_ALWAYS_ON must be in TOAST_STATUS_CODES or the notification is swallowed');
  });

  it('native-runtime effort-dropped copy covers Fable 5 (Codex P2)', () => {
    const src = read('agent-loop.ts');
    const toastIdx = src.indexOf("title: 'Effort ignored on this runtime'",
      src.indexOf('Official API: pass through sanitized thinking'));
    assert.ok(toastIdx > 0, 'official-API effort toast must exist');
    assert.match(src.slice(toastIdx, toastIdx + 400), /Fable 5/,
      'the effort-dropped message must name Fable 5 now that it is in the gated family');
  });
});
