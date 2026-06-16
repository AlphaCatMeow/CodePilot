import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import {
  createOrReuseChatMediaAsset,
  promoteChatMediaAsset,
} from '@/lib/chat-media-assets';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4AWMAAQAABQABDQottAAAAABJRU5ErkJggg==';

function ensureSession(id: string) {
  getDb().prepare(
    `INSERT OR IGNORE INTO chat_sessions (id, title, model)
     VALUES (?, ?, ?)`,
  ).run(id, 'asset test', 'gpt-image-2');
}

function ensureMessage(id: string, sessionId: string, role: 'user' | 'assistant', content: string) {
  getDb().prepare(
    `INSERT OR IGNORE INTO messages (id, session_id, role, content)
     VALUES (?, ?, ?, ?)`,
  ).run(id, sessionId, role, content);
}

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://test.local/api/chat/media-assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('chat media assets', () => {
  it('caches base64 chat images as tracked assets without media_generations rows', () => {
    const sessionId = 'sess-chat-asset-cache';
    ensureSession(sessionId);

    const first = createOrReuseChatMediaAsset({
      sessionId,
      mimeType: 'image/png',
      data: `data:image/png;base64,${TINY_PNG_BASE64}`,
      prompt: 'phoenix concert poster',
      model: 'gpt-image-2',
    });
    const second = createOrReuseChatMediaAsset({
      sessionId,
      mimeType: 'image/png',
      data: TINY_PNG_BASE64,
      prompt: 'same image',
      model: 'gpt-image-2',
    });

    assert.equal(second.assetId, first.assetId);
    assert.ok(fs.existsSync(first.cachePath));
    assert.match(first.contentUrl, new RegExp(`/api/chat/media-assets/${first.assetId}/content$`));

    const assetRow = getDb()
      .prepare('SELECT media_generation_id, cache_path FROM chat_media_assets WHERE id = ?')
      .get(first.assetId) as { media_generation_id: string | null; cache_path: string } | undefined;
    assert.ok(assetRow);
    assert.equal(assetRow!.media_generation_id, null);
    assert.equal(assetRow!.cache_path, first.cachePath);
  });

  it('promotes a cached asset into one media_generations row without marking it favorited', () => {
    const sessionId = 'sess-chat-asset-promote';
    ensureSession(sessionId);
    const asset = createOrReuseChatMediaAsset({
      sessionId,
      mimeType: 'image/png',
      data: TINY_PNG_BASE64,
      prompt: 'promote poster',
      model: 'gpt-image-2',
    });

    const first = promoteChatMediaAsset(asset.assetId);
    const second = promoteChatMediaAsset(asset.assetId);

    assert.equal(second.mediaId, first.mediaId);
    assert.ok(fs.existsSync(first.localPath));
    assert.notEqual(path.resolve(first.localPath), path.resolve(asset.cachePath));

    const row = getDb()
      .prepare('SELECT provider, prompt, favorited, local_path FROM media_generations WHERE id = ?')
      .get(first.mediaId) as { provider: string; prompt: string; favorited: number; local_path: string } | undefined;
    assert.ok(row);
    assert.equal(row!.provider, 'chat');
    assert.equal(row!.prompt, 'promote poster');
    assert.equal(row!.favorited, 0);
    assert.equal(row!.local_path, first.localPath);

    const count = getDb()
      .prepare('SELECT COUNT(*) AS count FROM media_generations WHERE local_path = ?')
      .get(first.localPath) as { count: number };
    assert.equal(count.count, 1);
  });

  it('repairs generic image alt prompts when an existing asset is reused with the real prompt', () => {
    const sessionId = 'sess-chat-asset-prompt-repair';
    ensureSession(sessionId);

    const asset = createOrReuseChatMediaAsset({
      sessionId,
      mimeType: 'image/png',
      data: TINY_PNG_BASE64,
      prompt: 'image_1',
      model: 'gpt-image-2',
    });
    const promoted = promoteChatMediaAsset(asset.assetId);

    const reused = createOrReuseChatMediaAsset({
      sessionId,
      mimeType: 'image/png',
      data: TINY_PNG_BASE64,
      prompt: '生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办，比例9:16',
      model: 'gpt-image-2',
    });

    assert.equal(reused.assetId, asset.assetId);
    const mediaRow = getDb()
      .prepare('SELECT prompt FROM media_generations WHERE id = ?')
      .get(promoted.mediaId) as { prompt: string } | undefined;
    const assetRow = getDb()
      .prepare('SELECT prompt FROM chat_media_assets WHERE id = ?')
      .get(asset.assetId) as { prompt: string } | undefined;

    assert.equal(mediaRow?.prompt, '生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办，比例9:16');
    assert.equal(assetRow?.prompt, '生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办，比例9:16');
  });

  it('binds legacy message-less assets to the exact message and repairs wrong prompts', () => {
    const sessionId = 'sess-chat-asset-message-bind';
    const assistantMessageId = 'msg-chat-asset-message-bind-assistant';
    ensureSession(sessionId);
    ensureMessage(assistantMessageId, sessionId, 'assistant', '![image_1](data:image/png;base64,...)');

    const legacy = createOrReuseChatMediaAsset({
      sessionId,
      mimeType: 'image/png',
      data: TINY_PNG_BASE64,
      prompt: '生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办，比例9:16',
      model: 'gpt-image-2',
    });
    const promoted = promoteChatMediaAsset(legacy.assetId);

    const rebound = createOrReuseChatMediaAsset({
      sessionId,
      messageId: assistantMessageId,
      mimeType: 'image/png',
      data: TINY_PNG_BASE64,
      prompt: '生成一张小猫图',
      model: 'gpt-image-2',
    });

    assert.equal(rebound.assetId, legacy.assetId);
    const mediaRow = getDb()
      .prepare('SELECT prompt, message_id FROM media_generations WHERE id = ?')
      .get(promoted.mediaId) as { prompt: string; message_id: string | null } | undefined;
    const assetRow = getDb()
      .prepare('SELECT prompt, message_id FROM chat_media_assets WHERE id = ?')
      .get(legacy.assetId) as { prompt: string; message_id: string | null } | undefined;

    assert.equal(mediaRow?.prompt, '生成一张小猫图');
    assert.equal(mediaRow?.message_id, assistantMessageId);
    assert.equal(assetRow?.prompt, '生成一张小猫图');
    assert.equal(assetRow?.message_id, assistantMessageId);
  });

  it('serves asset content through the controlled chat asset route', async () => {
    const sessionId = 'sess-chat-asset-content';
    ensureSession(sessionId);
    const asset = createOrReuseChatMediaAsset({
      sessionId,
      mimeType: 'image/png',
      data: TINY_PNG_BASE64,
    });

    const { GET } = await import('@/app/api/chat/media-assets/[id]/content/route');
    const response = await GET(
      new NextRequest(`http://test.local/api/chat/media-assets/${asset.assetId}/content`),
      { params: Promise.resolve({ id: asset.assetId }) },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  });

  it('rejects unsupported image MIME types at the route boundary', async () => {
    const sessionId = 'sess-chat-asset-reject';
    ensureSession(sessionId);

    const { POST } = await import('@/app/api/chat/media-assets/route');
    const response = await POST(createRequest({
      sessionId,
      mimeType: 'image/svg+xml',
      data: TINY_PNG_BASE64,
    }));

    assert.equal(response.status, 400);
  });
});
