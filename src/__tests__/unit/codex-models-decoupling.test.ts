/**
 * P0.3 (2026-06-01) — Codex model discovery must NOT block the global
 * model feed. A broken/old Codex app-server was hanging
 * `/api/providers/models` ~30s, freezing Settings overview, the chat
 * composer ("正在准备运行环境"), and the runtime health card.
 *
 * These tests drive listCodexModels / buildCodexProviderModelGroup through
 * a DI seam (fake app-server) so we can assert the spawn-decoupling
 * contract without a real subprocess:
 *   - cacheOnly never touches the app-server (no spawn).
 *   - a hung model/list rejects at the timeout instead of hanging.
 *
 * See docs/preview/packaged-preview-p0-diagnosis-2026-06-01.md
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  listCodexModels,
  buildCodexProviderModelGroup,
  invalidateCodexModelsCache,
} from '@/lib/codex/models';

const MODELS_RESULT = {
  data: [
    {
      id: 'gpt-5.5',
      model: 'gpt-5.5',
      displayName: 'GPT-5.5',
      description: '',
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: [{ effort: 'medium' }, { effort: 'high' }],
      defaultReasoningEffort: 'medium',
      inputModalities: ['text'],
    },
  ],
  nextCursor: null,
};

/** Fake app-server provider — a DI seam standing in for getCodexAppServer. */
function fakeAppServer(behavior: 'ok' | 'hang' | 'throw') {
  let calls = 0;
  return {
    get: async () => {
      calls++;
      if (behavior === 'throw') throw new Error('spawn refused (fake)');
      return {
        client: {
          request: <T>(_method: string, _params?: unknown): Promise<T> => {
            if (behavior === 'hang') return new Promise<T>(() => { /* never resolves */ });
            return Promise.resolve(MODELS_RESULT as T);
          },
        },
      };
    },
    calls: () => calls,
  };
}

describe('listCodexModels — P0.3 spawn decoupling', () => {
  beforeEach(() => invalidateCodexModelsCache());

  it('cacheOnly with empty cache returns [] and NEVER touches the app-server (no spawn)', async () => {
    const fake = fakeAppServer('throw'); // would throw if spawned
    const models = await listCodexModels({ cacheOnly: true }, fake.get);
    assert.deepEqual([...models], []);
    assert.equal(fake.calls(), 0, 'cacheOnly must not spawn the app-server');
  });

  it('timeoutMs rejects near the deadline when model/list never returns (does not hang)', async () => {
    const fake = fakeAppServer('hang');
    const start = Date.now();
    await assert.rejects(listCodexModels({ timeoutMs: 150 }, fake.get), /timed out/);
    assert.ok(Date.now() - start < 1500, 'must reject near the timeout, not hang');
  });

  it('returns mapped models on the happy path', async () => {
    const fake = fakeAppServer('ok');
    const models = await listCodexModels({}, fake.get);
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'gpt-5.5');
    assert.deepEqual([...models[0].supportedReasoningEfforts], ['medium', 'high']);
  });

  it('cacheOnly serves a warm cache populated by a prior fetch (still no spawn)', async () => {
    await listCodexModels({}, fakeAppServer('ok').get); // populate cache
    const fake = fakeAppServer('throw');
    const models = await listCodexModels({ cacheOnly: true }, fake.get);
    assert.equal(models.length, 1, 'warm cache should be served');
    assert.equal(fake.calls(), 0, 'cacheOnly must not spawn even to refresh');
  });
});

describe('buildCodexProviderModelGroup — P0.3', () => {
  beforeEach(() => invalidateCodexModelsCache());

  it('cacheOnly with empty cache returns null without spawning', async () => {
    const fake = fakeAppServer('throw');
    const group = await buildCodexProviderModelGroup({ cacheOnly: true }, fake.get);
    assert.equal(group, null);
    assert.equal(fake.calls(), 0);
  });

  it('returns a codex_account group when the app-server yields models', async () => {
    const fake = fakeAppServer('ok');
    const group = await buildCodexProviderModelGroup({}, fake.get);
    assert.ok(group);
    assert.equal(group!.provider_id, 'codex_account');
    assert.equal(group!.models.length, 1);
  });

  it('returns null (degraded) when model/list times out — no Codex group, no throw', async () => {
    const fake = fakeAppServer('hang');
    const group = await buildCodexProviderModelGroup({ timeoutMs: 150 }, fake.get);
    assert.equal(group, null);
  });
});

describe('providers/models route — P0.3 spawn-policy source pins', () => {
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/providers/models/route.ts'),
    'utf8',
  );

  it('full-catalog (no runtime) path uses cacheOnly — never spawns Codex', () => {
    assert.match(
      routeSrc,
      /else if \(!runtimeFilter\)[\s\S]{0,400}cacheOnly:\s*true/,
      'the no-runtime full-catalog branch must call buildCodexProviderModelGroup({ cacheOnly: true })',
    );
  });

  it('codex_runtime path bounds the spawn with a timeout', () => {
    assert.match(
      routeSrc,
      /runtimeFilter === 'codex_runtime'[\s\S]{0,400}timeoutMs:/,
      'the codex_runtime branch must pass a timeoutMs so a slow app-server degrades instead of hanging',
    );
  });

  it('never calls buildCodexProviderModelGroup with no options (the old unconditional spawn)', () => {
    assert.doesNotMatch(
      routeSrc,
      /buildCodexProviderModelGroup\(\)/,
      'the bare no-arg call would spawn from the full-catalog path — must pass cacheOnly/timeoutMs',
    );
  });
});
