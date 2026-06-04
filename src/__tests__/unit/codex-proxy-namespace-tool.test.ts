/**
 * Phase 5c slice 5 (2026-05-16, post-smoke) — `namespace` tool contract.
 *
 * Smoke evidence: real GLM-5 Turbo + Codex Runtime request 400'd with
 *
 *   tools[17] has unsupported type "namespace"
 *
 * — i.e. before slice 1 my `KNOWN_NON_FUNCTION_TYPES` set was
 * speculation, not real-fixture. Codex's wire shape for `namespace`
 * is gold-truth in `资料/codex/codex-rs/tools/src/tool_spec_tests.rs`
 * (the `namespace_tool_spec_serializes_expected_wire_shape` test).
 *
 * This file pins:
 *   1. parseResponsesRequest must accept a request whose tools[]
 *      contains a real Codex-shaped `namespace` entry (no 400).
 *   2. The classifier separates function tools from namespace tools:
 *      functions land on body.tools, namespace lands on
 *      passthroughTools.
 *   3. Bridge tools still merge through unified-adapter when a
 *      namespace tool is present (i.e. the namespace doesn't
 *      shadow the bridge).
 *   4. The full list of allowed non-function types matches Codex's
 *      ToolSpec enum source-of-truth; we don't drift back into
 *      speculative entries.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseResponsesRequest } from '@/lib/codex/proxy/parse-request';
import { createCodePilotBuiltinTools } from '@/lib/codex/proxy/builtin-bridge';

/**
 * Real Codex namespace wire shape verbatim from
 * `资料/codex/codex-rs/tools/src/tool_spec_tests.rs:154-196`
 * `namespace_tool_spec_serializes_expected_wire_shape`.
 *
 * Codex's MCP server bundles get serialised exactly like this, with
 * a nested `tools` array of function tools the model can call.
 */
const REAL_CODEX_NAMESPACE_TOOL = {
  type: 'namespace',
  name: 'mcp__demo__',
  description: 'Demo tools',
  tools: [
    {
      type: 'function',
      name: 'lookup_order',
      description: 'Look up an order',
      strict: false,
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
        },
      },
    },
  ],
} as const;

const baseBody = {
  model: 'glm-5-turbo',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
  stream: true,
};

// ─────────────────────────────────────────────────────────────────────
// (1) parseResponsesRequest accepts namespace tools
// ─────────────────────────────────────────────────────────────────────

describe('parseResponsesRequest — Codex `namespace` tool no longer trips unsupported_tool_kind', () => {
  it('namespace-only tools[] succeeds (pre-fix this returned 400 with the exact smoke error)', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [REAL_CODEX_NAMESPACE_TOOL],
    });
    assert.equal(result.ok, true, 'namespace MUST pass parsing — was failing in GLM/Kimi smoke');
    if (!result.ok) return;
    assert.equal(result.body.tools, undefined, 'namespace is not a function tool, so body.tools stays undefined');
    assert.equal(result.body.passthroughTools?.length, 1);
    assert.equal(result.body.passthroughTools?.[0].rawType, 'namespace');
    assert.equal(result.body.passthroughTools?.[0].name, 'mcp__demo__');
    // Nested function tools live inside the namespace payload — the
    // parser doesn't flatten them today (that's a future slice). We
    // pin that the raw shape is preserved so a future flattener can
    // read them without re-parsing.
    const nested = result.body.passthroughTools![0].payload.tools;
    assert.ok(Array.isArray(nested));
    assert.equal((nested as unknown[]).length, 1);
  });

  it('mixed real-Codex shape: function + namespace + custom + local_shell all classified, no rejection', () => {
    // The exact mix Codex's app-server sends in a realistic turn:
    // CodePilot provider function tools (think `codepilot_*` after
    // slice 2 mounts them) coexist with Codex's namespace MCP bundle
    // + custom apply_patch + local_shell.
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [
        { type: 'function', name: 'codepilot_generate_image' },
        REAL_CODEX_NAMESPACE_TOOL,
        { type: 'custom', name: 'apply_patch' },
        { type: 'local_shell' },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.body.tools?.map((t) => t.name),
      ['codepilot_generate_image'],
      'function tools list keeps codepilot_* in for the AI SDK',
    );
    assert.deepEqual(
      result.body.passthroughTools?.map((t) => t.rawType),
      ['namespace', 'custom', 'local_shell'],
      'all three non-function Codex types pass through in original order',
    );
  });

  it('tool_search is also a recognised passthrough (Codex tool-discovery surface)', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [{ type: 'tool_search', execution: 'eager', description: 'discover tools' }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.passthroughTools?.[0].rawType, 'tool_search');
  });

  it('genuinely-unknown type still trips structured unsupported_tool_kind (no permissive widening)', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [{ type: 'codex_future_shape_2027' }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /unsupported type "codex_future_shape_2027"/);
    // The known list must surface in the error so the developer can
    // tell which types we currently accept without reading the source.
    assert.match(result.message, /custom/);
    assert.match(result.message, /namespace/);
    assert.match(result.message, /local_shell/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (2) parser allowed-list matches the Codex ToolSpec enum source-of-truth
// ─────────────────────────────────────────────────────────────────────

describe('parse-request — allowed list matches Codex ToolSpec enum source-of-truth', () => {
  const parseRequestSrc = fs.readFileSync(
    path.resolve(__dirname, '../../lib/codex/proxy/parse-request.ts'),
    'utf-8',
  );

  it('lists every non-function discriminant Codex actually serialises', () => {
    // Pulled from `资料/codex/codex-rs/tools/src/tool_spec.rs` ToolSpec
    // enum (the `#[serde(tag = "type")]` rename strings, minus
    // `function` which has its own handler). If a future Codex
    // release adds a new variant, this test must be updated WITH the
    // KNOWN_NON_FUNCTION_TYPES set — keep them in lockstep.
    const codexEnumVariants = ['namespace', 'tool_search', 'local_shell', 'image_generation', 'web_search', 'custom'];
    for (const variant of codexEnumVariants) {
      assert.match(
        parseRequestSrc,
        new RegExp(`'${variant}'`),
        `KNOWN_NON_FUNCTION_TYPES must include '${variant}' — it's in Codex's ToolSpec enum`,
      );
    }
  });

  it('does NOT include the four speculative entries that pre-smoke slice 1 contained', () => {
    // Pre-smoke I'd added these speculatively. Codex source has none
    // of them. Listing them just papers over a real future schema
    // gap by accepting whatever string the upstream sends — better
    // to surface unknowns explicitly.
    const speculative = ['plugin', 'file_search', 'code_interpreter', 'web_search_preview'];
    for (const sp of speculative) {
      // Search for the quoted form so we don't false-positive on
      // names that appear in docstring prose (the docstring
      // mentions some of these as "removed").
      const inSet = new RegExp(`^\\s*'${sp}',?\\s*$`, 'm').test(parseRequestSrc);
      assert.equal(inSet, false, `KNOWN_NON_FUNCTION_TYPES must NOT include speculative '${sp}'`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (3) Bridge still merges when a namespace tool is in the request
// ─────────────────────────────────────────────────────────────────────

describe('createCodePilotBuiltinTools — bridge mounts independent of incoming namespace tools', () => {
  it('a request with a namespace tool does NOT prevent bridge tools from registering', () => {
    // The bridge mount decision is independent of the Codex tools[]
    // content — `createCodePilotBuiltinTools` only reads
    // sessionId + workspacePath + targetProviderId. This test pins
    // that decoupling so a future "rewrite parse-request" change
    // that accidentally couples the two surfaces fires here.
    const bridge = createCodePilotBuiltinTools({
      sessionId: 'chat-glm-1',
      workspacePath: '/Users/me/proj',
      targetProviderId: 'prov-glm-turbo',
    });
    assert.ok(bridge.tools.codepilot_generate_image, 'bridge image tool must mount regardless of incoming Codex tools[]');
    assert.ok(bridge.tools.codepilot_memory_recent, 'bridge memory tool must mount when workspace is bound');
    // The parser result (passthroughTools) lives on the request
    // body; the bridge mount lives on the response side. They
    // intentionally don't talk to each other.
    const parseResult = parseResponsesRequest({
      ...baseBody,
      tools: [REAL_CODEX_NAMESPACE_TOOL, { type: 'function', name: 'codepilot_generate_image' }],
    });
    assert.equal(parseResult.ok, true);
    if (!parseResult.ok) return;
    // Bridge wins on name collision with whatever Codex sent — pinned
    // by unified-adapter mergeToolSets behaviour; just confirm the
    // bridge still owns its slot.
    assert.equal(bridge.toolNames.has('codepilot_generate_image'), true);
  });
});
