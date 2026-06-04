/**
 * Phase 8 Phase 5 — Codex dynamic tool-call bridge (item/tool/call).
 *
 * Run: npx tsx --test src/__tests__/unit/codex-dynamic-tool-bridge.test.ts
 *
 * The model-autonomous path: Codex sends `item/tool/call` (a server
 * request) when the model decides to call a Memory tool mid-turn. The
 * bridge forwards an allowed call to Codex's MCP manager via
 * mcpServer/tool/call and shapes the DynamicToolCallResponse.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  handleCodexDynamicToolCall,
  type CodexDynamicToolCallParams,
  type McpToolCallResultLike,
} from '../../lib/codex/dynamic-tool-bridge';

function params(over: Partial<CodexDynamicToolCallParams> = {}): CodexDynamicToolCallParams {
  return {
    threadId: 't1',
    turnId: 'turn1',
    callId: 'call1',
    namespace: 'codepilot_memory',
    tool: 'codepilot_memory_recent',
    arguments: {},
    ...over,
  };
}

describe('handleCodexDynamicToolCall', () => {
  it('forwards an allowed memory call to mcpServer/tool/call and returns success text', async () => {
    const calls: unknown[] = [];
    const forward = async (req: unknown): Promise<McpToolCallResultLike> => {
      calls.push(req);
      return { content: [{ type: 'text', text: 'MEMTEST recent memory' }] };
    };
    const res = await handleCodexDynamicToolCall(
      params({ tool: 'codepilot_memory_recent', arguments: { q: 1 } }),
      forward,
    );
    // forwarded with namespace→server mapping (NOT bypassing Codex MCP mgr)
    assert.deepEqual(calls[0], {
      threadId: 't1',
      server: 'codepilot_memory',
      tool: 'codepilot_memory_recent',
      arguments: { q: 1 },
    });
    assert.equal(res.success, true);
    assert.deepEqual(res.contentItems, [{ type: 'inputText', text: 'MEMTEST recent memory' }]);
  });

  it('maps MCP isError:true → success:false (still returns the error text)', async () => {
    const forward = async (): Promise<McpToolCallResultLike> => ({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    });
    const res = await handleCodexDynamicToolCall(params({ tool: 'codepilot_memory_search' }), forward);
    assert.equal(res.success, false);
    assert.equal(res.contentItems[0].type, 'inputText');
    assert.match((res.contentItems[0] as { text: string }).text, /boom/);
  });

  it('unsupported namespace → graceful success:false, does NOT forward', async () => {
    let forwarded = false;
    const forward = async (): Promise<McpToolCallResultLike> => {
      forwarded = true;
      return {};
    };
    const res = await handleCodexDynamicToolCall(
      params({ namespace: 'user_weather', tool: 'get_forecast' }),
      forward,
    );
    assert.equal(forwarded, false, 'must not forward a non-allowlisted namespace');
    assert.equal(res.success, false);
    assert.match((res.contentItems[0] as { text: string }).text, /not available/i);
  });

  it('unsupported tool within codepilot_memory → graceful success:false, does NOT forward', async () => {
    let forwarded = false;
    const forward = async (): Promise<McpToolCallResultLike> => {
      forwarded = true;
      return {};
    };
    const res = await handleCodexDynamicToolCall(
      params({ tool: 'codepilot_memory_delete_everything' }),
      forward,
    );
    assert.equal(forwarded, false);
    assert.equal(res.success, false);
  });

  it('null namespace → graceful success:false', async () => {
    const res = await handleCodexDynamicToolCall(
      params({ namespace: null, tool: 'whatever' }),
      async () => ({}),
    );
    assert.equal(res.success, false);
  });

  it('falls back to structuredContent / JSON when no text content', async () => {
    const forward = async (): Promise<McpToolCallResultLike> => ({
      content: [],
      structuredContent: { hits: 3 },
    });
    const res = await handleCodexDynamicToolCall(params({ tool: 'codepilot_memory_search' }), forward);
    assert.equal(res.success, true);
    assert.equal((res.contentItems[0] as { text: string }).text, JSON.stringify({ hits: 3 }));
  });

  it('a forward failure becomes a graceful success:false (never throws to method-not-found)', async () => {
    const forward = async (): Promise<McpToolCallResultLike> => {
      throw new Error('mcp manager exploded');
    };
    const res = await handleCodexDynamicToolCall(params(), forward);
    assert.equal(res.success, false);
    assert.match((res.contentItems[0] as { text: string }).text, /failed.*exploded/i);
  });
});

describe('runtime.ts — dynamic tool call wiring (source pin)', () => {
  const runtimeSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/codex/runtime.ts'), 'utf-8');

  it('registers item/tool/call and forwards via mcpServer/tool/call', () => {
    assert.ok(runtimeSrc.includes("onServerRequest('item/tool/call'"), 'must register item/tool/call handler');
    assert.ok(runtimeSrc.includes('handleCodexDynamicToolCall'), 'must use the bridge handler');
    assert.match(
      runtimeSrc,
      /client\.request<[^>]*>\('mcpServer\/tool\/call'/,
      'dynamic calls must forward through mcpServer/tool/call (keep Codex MCP lifecycle)',
    );
  });
});
