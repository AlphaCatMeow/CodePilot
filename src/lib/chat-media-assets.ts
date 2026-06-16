import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/lib/db';
import { importFileToLibrary } from '@/lib/media-saver';
import type { ChatMediaAsset } from '@/types';

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export interface CreateChatMediaAssetInput {
  sessionId: string;
  messageId?: string;
  mimeType: string;
  data: string;
  prompt?: string;
  model?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMediaAssetResult {
  assetId: string;
  mimeType: string;
  sha256: string;
  cachePath: string;
  contentUrl: string;
  mediaId: string | null;
}

export interface PromoteChatMediaAssetResult {
  assetId: string;
  mediaId: string;
  localPath: string;
  favorited: boolean;
}

function getDataDir(): string {
  return process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
}

function getCacheDir(sessionId: string): string {
  return path.join(getDataDir(), '.codepilot-cache', 'chat-images', sessionId);
}

function canonicalCacheRoot(): string {
  return path.resolve(getDataDir(), '.codepilot-cache', 'chat-images');
}

function isInsideCacheRoot(filePath: string): boolean {
  const root = canonicalCacheRoot();
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType.toLowerCase();
}

export function assertSupportedChatImageMime(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  if (!ALLOWED_IMAGE_MIME.has(normalized)) {
    throw new Error('Unsupported image MIME type');
  }
  return normalized;
}

function parseData(input: string, mimeType: string): Buffer {
  const normalized = assertSupportedChatImageMime(mimeType);
  let base64 = input.trim();
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(base64);
  if (match) {
    const dataMime = assertSupportedChatImageMime(match[1]);
    if (dataMime !== normalized) {
      throw new Error('Data URL MIME type does not match request MIME type');
    }
    base64 = match[2].trim();
  }
  if (!base64) {
    throw new Error('Missing image data');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new Error('Invalid image data');
  }
  return buffer;
}

function mapAsset(row: ChatMediaAsset): ChatMediaAssetResult {
  return {
    assetId: row.id,
    mimeType: row.mime_type,
    sha256: row.sha256,
    cachePath: row.cache_path,
    contentUrl: `/api/chat/media-assets/${encodeURIComponent(row.id)}/content`,
    mediaId: row.media_generation_id || null,
  };
}

function isGenericImageAltPrompt(prompt: string): boolean {
  return /^image(?:[_ -]?\d+)?$/i.test(prompt.trim());
}

function maybeRepairAssetContext(
  asset: ChatMediaAsset,
  input: Pick<CreateChatMediaAssetInput, 'messageId' | 'prompt'>,
): ChatMediaAsset {
  const nextPrompt = input.prompt?.trim();
  const nextMessageId = input.messageId?.trim();
  const shouldBindMessage = Boolean(nextMessageId && !asset.message_id);
  const shouldUpdatePrompt = Boolean(
    nextPrompt &&
    !isGenericImageAltPrompt(nextPrompt) &&
    (isGenericImageAltPrompt(asset.prompt) || shouldBindMessage)
  );

  if (!shouldBindMessage && !shouldUpdatePrompt) {
    return asset;
  }

  const db = getDb();
  db.prepare(
    `UPDATE chat_media_assets
     SET message_id = COALESCE(?, message_id),
         prompt = CASE WHEN ? THEN ? ELSE prompt END
     WHERE id = ?`,
  ).run(nextMessageId || null, shouldUpdatePrompt ? 1 : 0, nextPrompt || asset.prompt, asset.id);

  if (asset.media_generation_id) {
    db.prepare(
      `UPDATE media_generations
       SET message_id = COALESCE(?, message_id),
           prompt = CASE WHEN ? THEN ? ELSE prompt END
       WHERE id = ?`,
    ).run(nextMessageId || null, shouldUpdatePrompt ? 1 : 0, nextPrompt || asset.prompt, asset.media_generation_id);
  }

  return {
    ...asset,
    message_id: nextMessageId || asset.message_id,
    prompt: shouldUpdatePrompt && nextPrompt ? nextPrompt : asset.prompt,
  };
}

export function getChatMediaAsset(assetId: string): ChatMediaAsset | undefined {
  return getDb()
    .prepare('SELECT * FROM chat_media_assets WHERE id = ?')
    .get(assetId) as ChatMediaAsset | undefined;
}

export function createOrReuseChatMediaAsset(input: CreateChatMediaAssetInput): ChatMediaAssetResult {
  const mimeType = assertSupportedChatImageMime(input.mimeType);
  const buffer = parseData(input.data, mimeType);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const source = input.source || 'markdown-data-url';
  const db = getDb();

  const existing = input.messageId
    ? db.prepare(
      `SELECT * FROM chat_media_assets
       WHERE session_id = ? AND sha256 = ? AND source = ?
         AND (message_id = ? OR message_id IS NULL)
       ORDER BY CASE WHEN message_id = ? THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
    ).get(input.sessionId, sha256, source, input.messageId, input.messageId) as ChatMediaAsset | undefined
    : db.prepare(
      `SELECT * FROM chat_media_assets
       WHERE session_id = ? AND sha256 = ? AND source = ?
       ORDER BY created_at ASC
       LIMIT 1`,
    ).get(input.sessionId, sha256, source) as ChatMediaAsset | undefined;

  if (existing) {
    if (!fs.existsSync(existing.cache_path)) {
      fs.mkdirSync(path.dirname(existing.cache_path), { recursive: true });
      fs.writeFileSync(existing.cache_path, buffer);
    }
    return mapAsset(maybeRepairAssetContext(existing, input));
  }

  const assetId = crypto.randomBytes(16).toString('hex');
  const cacheDir = getCacheDir(input.sessionId);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${assetId}${MIME_TO_EXT[mimeType] || '.bin'}`);
  fs.writeFileSync(cachePath, buffer);

  db.prepare(
    `INSERT INTO chat_media_assets
      (id, session_id, message_id, kind, source, mime_type, sha256, cache_path, media_generation_id, prompt, model, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assetId,
    input.sessionId,
    input.messageId || null,
    'image',
    source,
    mimeType,
    sha256,
    cachePath,
    null,
    input.prompt || '',
    input.model || '',
    JSON.stringify(input.metadata || {}),
  );

  const created = getChatMediaAsset(assetId);
  if (!created) {
    throw new Error('Failed to create chat media asset');
  }
  return mapAsset(created);
}

export function resolveChatMediaAssetFile(assetId: string): { filePath: string; mimeType: string } {
  const asset = getChatMediaAsset(assetId);
  if (!asset) {
    throw new Error('Chat media asset not found');
  }

  const cachePath = path.resolve(asset.cache_path);
  if (isInsideCacheRoot(cachePath) && fs.existsSync(cachePath)) {
    return { filePath: cachePath, mimeType: asset.mime_type };
  }

  if (asset.media_generation_id) {
    const row = getDb()
      .prepare('SELECT local_path FROM media_generations WHERE id = ?')
      .get(asset.media_generation_id) as { local_path: string } | undefined;
    if (row?.local_path && fs.existsSync(row.local_path)) {
      return { filePath: row.local_path, mimeType: asset.mime_type };
    }
  }

  throw new Error('Chat media asset file not found');
}

export function promoteChatMediaAsset(assetId: string): PromoteChatMediaAssetResult {
  const asset = getChatMediaAsset(assetId);
  if (!asset) {
    throw new Error('Chat media asset not found');
  }

  const db = getDb();
  if (asset.media_generation_id) {
    const row = db.prepare('SELECT id, local_path, favorited FROM media_generations WHERE id = ?')
      .get(asset.media_generation_id) as { id: string; local_path: string; favorited: number } | undefined;
    if (row) {
      return {
        assetId,
        mediaId: row.id,
        localPath: row.local_path,
        favorited: !!row.favorited,
      };
    }
  }

  const { filePath } = resolveChatMediaAssetFile(assetId);
  const result = importFileToLibrary(filePath, {
    sessionId: asset.session_id,
    source: 'chat',
    mimeType: asset.mime_type,
    prompt: asset.prompt,
    model: asset.model,
  });

  db.prepare(
    `UPDATE media_generations
     SET message_id = ?
     WHERE id = ?`,
  ).run(asset.message_id || null, result.mediaId);

  db.prepare(
    `UPDATE chat_media_assets
     SET media_generation_id = ?, promoted_at = datetime('now')
     WHERE id = ?`,
  ).run(result.mediaId, assetId);

  return {
    assetId,
    mediaId: result.mediaId,
    localPath: result.localPath,
    favorited: false,
  };
}
