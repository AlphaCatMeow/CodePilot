/**
 * Env (built-in "Claude Code") 模型列表单一出口回归 (Codex review P1, 2026-06-10)。
 *
 * 背景:env 默认模型列表曾有三份手工镜像 —— provider-resolver.ts envModels、
 * /api/providers/models route 的 DEFAULT_MODELS + ENV_ALIAS_TO_UPSTREAM、
 * useProviderModels.ts 的客户端 fallback。三份已漂移:resolver 有
 * opus-4-8 + fable-5,另外两份连 opus-4-8 都没有 —— 用户在模型选择器的
 * Claude Code 组里看不到新模型。
 *
 * 现在三处必须全部派生自 provider-catalog.ts 的 ENV_CLAUDE_CODE_MODELS。
 * 本文件钉住:(a) route 真实返回包含 fable-5 / opus-4-8 及其能力;
 * (b) 三个消费方不许再各自硬编码一份。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { ENV_CLAUDE_CODE_MODELS } from '../../lib/provider-catalog';
import { getSetting, setSetting } from '../../lib/db';
import { GET as modelsGET } from '../../app/api/providers/models/route';

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');

describe('ENV_CLAUDE_CODE_MODELS — canonical content', () => {
  it('ships the full alias set including opus-4-8 and fable-5', () => {
    const ids = new Set(ENV_CLAUDE_CODE_MODELS.map(m => m.modelId));
    for (const expected of ['sonnet', 'opus', 'opus-4-8', 'fable-5', 'haiku']) {
      assert.ok(ids.has(expected), `env model list must contain ${expected}`);
    }
  });

  it('fable-5 maps to claude-fable-5 with full effort levels + adaptive thinking', () => {
    const fable = ENV_CLAUDE_CODE_MODELS.find(m => m.modelId === 'fable-5')!;
    assert.equal(fable.upstreamModelId, 'claude-fable-5');
    assert.equal(fable.capabilities?.supportsEffort, true);
    assert.deepEqual(fable.capabilities?.supportedEffortLevels,
      ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(fable.capabilities?.supportsAdaptiveThinking, true);
    assert.equal('role' in fable && fable.role !== undefined, false,
      'env list entries must not carry role mappings');
  });
});

describe('/api/providers/models — env group serves the canonical list', () => {
  let snapRuntime: string;

  before(() => {
    snapRuntime = getSetting('agent_runtime') ?? '';
    setSetting('agent_runtime', 'auto'); // env group hidden only under 'native'
    // Ensure SDK capability cache can't shadow DEFAULT_MODELS in this process.
    (globalThis as Record<string, unknown>)['__agentSdkCapabilities__'] = new Map();
  });

  after(() => {
    setSetting('agent_runtime', snapRuntime);
  });

  it('returns provider_id "env" / "Claude Code" group containing fable-5 with upstream + 1M + effort', async () => {
    const res = await modelsGET(new NextRequest('http://localhost/api/providers/models'));
    assert.equal(res.status, 200);
    const body = await res.json();
    const envGroup = (body.groups as Array<{
      provider_id: string;
      provider_name: string;
      models: Array<Record<string, unknown>>;
    }>).find(g => g.provider_id === 'env');
    assert.ok(envGroup, 'env group must be present when agent_runtime != native');
    assert.equal(envGroup!.provider_name, 'Claude Code');

    const fable = envGroup!.models.find(m => m.value === 'fable-5');
    assert.ok(fable, 'env group must include fable-5 (Codex P1: picker missed it)');
    assert.equal(fable!.label, 'Fable 5');
    assert.equal(fable!.upstreamModelId, 'claude-fable-5');
    assert.equal(fable!.contextWindow, 1_000_000);
    assert.equal(fable!.supportsEffort, true);
    assert.deepEqual(fable!.supportedEffortLevels, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(fable!.supportsAdaptiveThinking, true);

    // opus-4-8 was missing from the same hand-maintained copy — pin it too.
    const opus48 = envGroup!.models.find(m => m.value === 'opus-4-8');
    assert.ok(opus48, 'env group must include opus-4-8');
    assert.equal(opus48!.upstreamModelId, 'claude-opus-4-8');
  });
});

describe('no third copy — all consumers derive from ENV_CLAUDE_CODE_MODELS', () => {
  const CONSUMERS = [
    'app/api/providers/models/route.ts',
    'hooks/useProviderModels.ts',
    'lib/provider-resolver.ts',
  ];

  for (const file of CONSUMERS) {
    it(`${file} imports ENV_CLAUDE_CODE_MODELS and has no re-hardcoded env list`, () => {
      const src = read(file);
      assert.match(src, /ENV_CLAUDE_CODE_MODELS/,
        `${file} must derive from the canonical export`);
      // The drift signature: a hand-written entry pairing the Opus 4.7
      // upstream with its label. Deriving consumers contain neither.
      assert.doesNotMatch(src, /label:\s*'Opus 4\.7'/,
        `${file} must not re-hardcode env model entries`);
      assert.doesNotMatch(src, /upstreamModelId:\s*'claude-opus-4-7'/,
        `${file} must not re-hardcode env alias→upstream rows`);
    });
  }
});
