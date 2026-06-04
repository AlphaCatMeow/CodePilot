/**
 * Phase 5d Phase 2 P0 (2026-05-17) — Codex proxy adapter MUST send
 * the compiler-produced prompt through the `messages[]` channel,
 * not only through `providerOptions.openai.instructions`.
 *
 * Pre-fix the adapter called `buildMessages(input.body)` BEFORE
 * `compileContext` and `bodyWithBridgePrompt`, so the compiler
 * prompt only travelled via `providerOptions.openai.instructions`.
 * That field is consumed by OpenAI Responses-API paths; Anthropic-
 * compatible / CodePlan / OpenAI chat-completions paths read the
 * messages array and would have lost the wire-format spec + every
 * capability prompt on the send path.
 *
 * Two layers of pin here:
 *   1. Source-grep: forbid `buildMessages(input.body)` in
 *      unified-adapter.ts (must be `buildMessages(bodyWithBridgePrompt)`).
 *   2. Behavioural: drive a real `createUnifiedAdapter` against a
 *      mock provider stub via `registerAdapter`-free path is hard,
 *      so verify via source-pin that bodyWithBridgePrompt is what
 *      flows into buildMessages.
 *
 * If the proxy ever invokes a real `streamText`, the system message
 * the upstream model receives is `bodyWithBridgePrompt.instructions`
 * (which contains the compiler's `systemPromptText` spliced via
 * `combineInstructions`). The pin below confirms the ordering that
 * makes this true.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ADAPTER_SRC_RAW = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/proxy/unified-adapter.ts'),
  'utf-8',
);

/** Strip line + block comments + JSDoc-continuation lines so the
 *  source-pins can target actual code rather than the slice's
 *  explanatory comments (which intentionally quote pre-fix shapes
 *  like `buildMessages(input.body)` for context). */
function stripComments(src: string): string {
  const lines: string[] = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const trimmed = raw.trimStart();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    // Strip trailing `// ...` line comments.
    const idx = raw.indexOf('//');
    lines.push(idx >= 0 ? raw.slice(0, idx) : raw);
  }
  return lines.join('\n');
}

const ADAPTER_SRC = stripComments(ADAPTER_SRC_RAW);

describe('unified-adapter — compiler prompt reaches messages[] (P0 regression)', () => {
  it('source MUST NOT call buildMessages(input.body) anywhere', () => {
    // Pre-P0 the adapter had `messages = buildMessages(input.body)`
    // before the compileContext call. Any reintroduction of that
    // pattern reverts the P0 fix and silently breaks
    // Anthropic-compat / CodePlan / chat-completions paths.
    assert.equal(
      /buildMessages\(\s*input\.body\s*\)/.test(ADAPTER_SRC),
      false,
      'buildMessages(input.body) is the pre-P0 shape — re-introducing it loses the compiler prompt for non-Responses provider paths',
    );
  });

  it('source MUST call buildMessages(bodyWithBridgePrompt) — the spliced body', () => {
    assert.match(
      ADAPTER_SRC,
      /buildMessages\(\s*bodyWithBridgePrompt\s*\)/,
      'adapter must feed buildMessages the body that already has compiler prompt spliced into instructions',
    );
  });

  it('source MUST run adaptForCodexProxy BEFORE buildMessages', () => {
    // Phase 5d Phase 3 (2026-05-17) — the compile call moved into
    // the Runtime Capability Adapter facade (`adaptForCodexProxy`).
    // The ordering invariant is the same: the facade call (which
    // internally runs `compileContext`) must finish before
    // `buildMessages` reads `bodyWithBridgePrompt.instructions`.
    // Pin shifted from `compileContext({` to `adaptForCodexProxy({`.
    const compileIdx = ADAPTER_SRC.indexOf('adaptForCodexProxy({');
    const buildMessagesIdx = ADAPTER_SRC.indexOf('buildMessages(bodyWithBridgePrompt)');
    assert.ok(compileIdx > 0, 'adaptForCodexProxy({...}) call must exist');
    assert.ok(buildMessagesIdx > 0, 'buildMessages(bodyWithBridgePrompt) call must exist');
    assert.ok(
      compileIdx < buildMessagesIdx,
      `adaptForCodexProxy (idx=${compileIdx}) must run BEFORE buildMessages (idx=${buildMessagesIdx}); reversing the order is the P0 regression`,
    );
  });

  it('source MUST run bodyWithBridgePrompt construction BEFORE buildMessages', () => {
    // The body splice happens in a `const bodyWithBridgePrompt =`
    // line. Confirm it precedes the buildMessages call so the
    // spliced instructions are actually what buildMessages reads.
    const bodySpliceIdx = ADAPTER_SRC.indexOf('const bodyWithBridgePrompt');
    const buildMessagesIdx = ADAPTER_SRC.indexOf('buildMessages(bodyWithBridgePrompt)');
    assert.ok(bodySpliceIdx > 0);
    assert.ok(buildMessagesIdx > 0);
    assert.ok(
      bodySpliceIdx < buildMessagesIdx,
      'bodyWithBridgePrompt must be constructed before buildMessages is called',
    );
  });
});

describe('unified-adapter — buildMessages prepends instructions as a system message (downstream contract)', () => {
  it('buildMessages helper prepends `body.instructions` as role:system at index 0', () => {
    // The helper is internal; pin via source so a future "drop the
    // system message" refactor is caught. The model only sees the
    // compiler prompt because buildMessages prepends instructions
    // as a role:system message; remove that and the P0 fix loses
    // its delivery vehicle.
    assert.match(
      ADAPTER_SRC,
      /function\s+buildMessages\(body[^)]*\)[^{]*\{[\s\S]{0,400}role:\s*['"]system['"]\s*,\s*content:\s*body\.instructions/,
      'buildMessages must prepend body.instructions as the first system message — that is what carries the compiled prompt to non-Responses providers',
    );
  });
});
