import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  VENDOR_PRESETS,
  PresetSchema,
  canReliablyFetchModels,
  findMatchingPresetForRecord,
  getEffectiveProviderProtocol,
} from '@/lib/provider-catalog';
import { getProviderCompat } from '@/lib/runtime-compat';
import {
  normalizeOpenAICompatibleBaseUrl,
  validateOpenAICompatibleBaseUrl,
} from '@/lib/provider-openai-compatible';
import { type ResolvedProvider, toAiSdkConfig } from '@/lib/provider-resolver';
import { testProviderConnection } from '@/lib/claude-client';
import { POST as providersPOST } from '@/app/api/providers/route';
import { PUT as providerPUT } from '@/app/api/providers/[id]/route';
import { createProvider, deleteProvider, getProvider } from '@/lib/db';

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/providers/test-openai-compatible', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('OpenAI-compatible third-party provider preset', () => {
  it('ships a chat preset that passes catalog schema validation', () => {
    const preset = VENDOR_PRESETS.find((p) => p.key === 'openai-compatible');
    assert.ok(preset, 'openai-compatible preset must exist');
    assert.equal(preset.protocol, 'openai-compatible');
    assert.equal(preset.authStyle, 'api_key');
    assert.equal(preset.baseUrl, '');
    assert.deepEqual(preset.fields, ['name', 'api_key', 'base_url', 'model_names']);
    assert.notEqual(preset.category, 'media');
    assert.equal(PresetSchema.safeParse(preset).success, true);
  });

  it('maps provider_type=openai-compatible through catalog, discovery and runtime helpers', () => {
    const record = {
      provider_type: 'openai-compatible',
      base_url: 'https://api.example.com/v1',
    };
    assert.equal(getEffectiveProviderProtocol(record.provider_type, '', record.base_url), 'openai-compatible');
    assert.equal(findMatchingPresetForRecord(record)?.key, 'openai-compatible');
    assert.equal(canReliablyFetchModels(record).reliable, true);
    assert.equal(getProviderCompat(record), 'codepilot_only');
  });

  it('does not classify OpenAI-compatible chat providers as OpenAI image providers', () => {
    assert.equal(
      findMatchingPresetForRecord({
        provider_type: 'openai-compatible',
        base_url: 'https://api.openai.com/v1',
      })?.key,
      'openai-compatible',
    );
  });

  it('forces Chat Completions for GPT-5-like model names on generic OpenAI-compatible gateways', () => {
    const resolved: ResolvedProvider = {
      provider: {
        id: 'test',
        name: 'OpenAI Compatible',
        provider_type: 'openai-compatible',
        protocol: 'openai-compatible',
        base_url: 'https://api.example.com/v1',
        api_key: 'sk-test',
        is_active: 1,
        sort_order: 0,
        extra_env: '{}',
        headers_json: '{}',
        env_overrides_json: '',
        role_models_json: '{}',
        notes: '',
        created_at: '',
        updated_at: '',
        options_json: '{}',
      },
      protocol: 'openai-compatible',
      authStyle: 'api_key',
      model: 'gpt-5.5',
      modelDisplayName: undefined,
      upstreamModel: undefined,
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: true,
      availableModels: [],
      settingSources: ['project', 'local'],
    };

    const config = toAiSdkConfig(resolved, 'gpt-5.5');
    assert.equal(config.sdkType, 'openai');
    assert.equal(config.baseUrl, 'https://api.example.com/v1');
    assert.equal(config.modelId, 'gpt-5.5');
    assert.equal(config.useResponsesApi, undefined);
    assert.equal(config.forceChatCompletions, true);
  });
});

describe('OpenAI-compatible base URL normalization', () => {
  it('normalizes a plain host to a /v1 base URL', () => {
    const result = normalizeOpenAICompatibleBaseUrl('https://api.example.com/');
    assert.deepEqual(result, {
      ok: true,
      value: 'https://api.example.com/v1',
      normalized: true,
    });
  });

  it('keeps an explicit /v1 base URL unchanged except for trailing slashes', () => {
    const result = normalizeOpenAICompatibleBaseUrl('https://api.example.com/v1/');
    assert.deepEqual(result, {
      ok: true,
      value: 'https://api.example.com/v1',
      normalized: true,
    });
  });

  it('accepts provider-specific paths only when they end in /v1', () => {
    assert.equal(
      normalizeOpenAICompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1').ok,
      true,
    );
    const invalid = normalizeOpenAICompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode');
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.code, 'OPENAI_COMPATIBLE_V1_REQUIRED');
    }
  });

  it('rejects empty and non-http URLs', () => {
    assert.equal(validateOpenAICompatibleBaseUrl('').ok, false);
    assert.equal(validateOpenAICompatibleBaseUrl('ftp://api.example.com/v1').ok, false);
    assert.equal(validateOpenAICompatibleBaseUrl('not-a-url').ok, false);
  });
});

describe('/api/providers write guards for OpenAI-compatible providers', () => {
  let createdProviderId = '';

  after(() => {
    if (createdProviderId) deleteProvider(createdProviderId);
  });

  it('POST rejects missing base_url for openai-compatible providers', async () => {
    const res = await providersPOST(postReq({
      name: 'Bad OpenAI Compatible',
      provider_type: 'openai-compatible',
      protocol: 'openai-compatible',
      api_key: 'sk-test',
    }));
    assert.equal(res.status, 400);
    const body = await res.json() as { code?: string };
    assert.equal(body.code, 'OPENAI_COMPATIBLE_BASE_URL_REQUIRED');
  });

  it('POST rejects custom paths that do not end in /v1', async () => {
    const res = await providersPOST(postReq({
      name: 'Bad OpenAI Compatible',
      provider_type: 'openai-compatible',
      protocol: 'openai-compatible',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode',
      api_key: 'sk-test',
    }));
    assert.equal(res.status, 400);
    const body = await res.json() as { code?: string };
    assert.equal(body.code, 'OPENAI_COMPATIBLE_V1_REQUIRED');
  });

  it('POST normalizes a plain host before saving', async () => {
    const res = await providersPOST(postReq({
      name: 'OpenAI Compatible Host',
      provider_type: 'openai-compatible',
      protocol: 'openai-compatible',
      base_url: 'https://api.openai-compatible-host.test',
      api_key: 'sk-test',
    }));
    assert.equal(res.status, 201);
    const body = await res.json() as { provider: { id: string; base_url: string } };
    createdProviderId = body.provider.id;
    assert.equal(body.provider.base_url, 'https://api.openai-compatible-host.test/v1');
  });

  it('persists OpenAI-compatible protocol records through existing provider CRUD', () => {
    const provider = createProvider({
      name: 'OpenAI Compatible Persist',
      provider_type: 'openai-compatible',
      protocol: 'openai-compatible',
      base_url: 'https://api.persist-openai-compatible.test/v1',
      api_key: 'sk-test',
      extra_env: '{}',
    });
    const saved = getProvider(provider.id);
    deleteProvider(provider.id);

    assert.equal(saved?.provider_type, 'openai-compatible');
    assert.equal(saved?.protocol, 'openai-compatible');
    assert.equal(saved?.base_url, 'https://api.persist-openai-compatible.test/v1');
  });

  it('PUT applies the same base_url validation after merging with the existing provider', async () => {
    const provider = createProvider({
      name: 'OpenAI Compatible Update',
      provider_type: 'openai-compatible',
      protocol: 'openai-compatible',
      base_url: 'https://api.update-openai-compatible.test/v1',
      api_key: 'sk-test',
      extra_env: '{}',
    });
    const res = await providerPUT(
      putReq({ base_url: '' }),
      { params: Promise.resolve({ id: provider.id }) },
    );
    deleteProvider(provider.id);
    assert.equal(res.status, 400);
    const body = await res.json() as { code?: string };
    assert.equal(body.code, 'OPENAI_COMPATIBLE_BASE_URL_REQUIRED');
  });
});

describe('testProviderConnection — OpenAI-compatible probe', () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses GET /models with Bearer auth and no Anthropic headers', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await testProviderConnection({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      protocol: 'openai-compatible',
      authStyle: 'api_key',
      providerName: 'OpenAI Compat',
    });

    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.com/v1/models');
    assert.equal(calls[0].init?.method, 'GET');
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer sk-test');
    assert.equal(headers.has('anthropic-version'), false);
    assert.equal(headers.has('x-api-key'), false);
  });

  it('fails when the upstream response is not an OpenAI model list', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    const result = await testProviderConnection({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      protocol: 'openai-compatible',
      authStyle: 'api_key',
      providerName: 'OpenAI Compat',
    });

    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'BAD_MODEL_LIST');
  });
});
