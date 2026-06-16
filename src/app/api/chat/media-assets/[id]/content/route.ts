import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { resolveChatMediaAssetFile } from '@/lib/chat-media-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { filePath, mimeType } = resolveChatMediaAssetFile(id);
    const buffer = await fs.readFile(filePath);
    return new Response(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read chat media asset';
    const status = message.includes('not found') ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
