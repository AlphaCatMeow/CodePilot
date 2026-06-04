/**
 * Phase 5c (2026-05-16) — Codex Account never sees the bridge.
 *
 * Codex Account routes through Codex's own auth path (chat.openai
 * backend) WITHOUT the codepilot_proxy injection. The proxy's
 * `adapter.ts` virtual-provider check fires earlier with a routing-
 * bug error if the request ever reaches the proxy, but the bridge
 * itself ALSO refuses to mount for codex_account as defence in
 * depth — if a future change accidentally removes the upstream
 * guard, the bridge wouldn't suddenly hijack Codex Account's
 * native tool surface (Skills / image_gen / etc.).
 *
 * This file pins both layers:
 *   1. createCodePilotBuiltinTools refuses codex_account.
 *   2. buildCodexThreadParams for codex_account produces NO proxy
 *      injection (verified via header / config absence) — confirmed
 *      separately in codex-proxy-headers.test.ts but mirrored here
 *      because the bridge guardrail and the routing guardrail are
 *      conceptually paired.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCodePilotBuiltinTools } from '@/lib/codex/proxy/builtin-bridge';
import { buildCodexThreadParams } from '@/lib/codex/provider-proxy';

describe('Codex Account guardrails — bridge layer', () => {
  it('createCodePilotBuiltinTools returns empty bridge for codex_account', () => {
    const bridge = createCodePilotBuiltinTools({
      sessionId: 'chat-1',
      targetProviderId: 'codex_account',
      workspacePath: '/Users/me/proj',
    });
    assert.equal(Object.keys(bridge.tools).length, 0, 'no tools must mount for Codex Account — its native paths own these capabilities');
    assert.equal(bridge.toolNames.size, 0);
    assert.equal(bridge.systemPrompt, '');
    assert.match(bridge.skippedReason ?? '', /Codex Account/);
  });

  it('non-codex_account provider gets the full bridge surface (control)', () => {
    const bridge = createCodePilotBuiltinTools({
      sessionId: 'chat-1',
      targetProviderId: 'prov-glm',
      workspacePath: '/Users/me/proj',
    });
    assert.ok(Object.keys(bridge.tools).length > 0, 'control: non-codex_account must mount tools');
    assert.equal(bridge.skippedReason, undefined);
  });
});

describe('Codex Account guardrails — thread params layer (mirror of codex-proxy-headers.test.ts)', () => {
  it('buildCodexThreadParams emits NO modelProvider/config for codex_account', () => {
    const params = buildCodexThreadParams({
      providerId: 'codex_account',
      workingDirectory: '/Users/me/proj',
      proxyBaseUrl: 'http://127.0.0.1:3000',
      model: 'gpt-5.5',
      sessionId: 'chat-1',
    });
    // codex_account path returns cwd + model only — the proxy
    // injection (modelProvider + config + headers) is absent so
    // Codex's native model_providers["openai"] entry wins.
    assert.equal(params.modelProvider, undefined);
    assert.equal(params.config, undefined);
    assert.equal(params.cwd, '/Users/me/proj');
    assert.equal(params.model, 'gpt-5.5');
  });
});
