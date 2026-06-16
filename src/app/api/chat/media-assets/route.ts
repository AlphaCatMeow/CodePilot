import { NextRequest, NextResponse } from 'next/server';
import { createOrReuseChatMediaAsset } from '@/lib/chat-media-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateAssetBody {
  sessionId?: string;
  messageId?: string;
  mimeType?: string;
  data?: string;
  prompt?: string;
  model?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as CreateAssetBody;
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!body.mimeType) {
      return NextResponse.json({ error: 'mimeType is required' }, { status: 400 });
    }
    if (!body.data) {
      return NextResponse.json({ error: 'data is required' }, { status: 400 });
    }

    const result = createOrReuseChatMediaAsset({
      sessionId: body.sessionId,
      messageId: body.messageId,
      mimeType: body.mimeType,
      data: body.data,
      prompt: body.prompt,
      model: body.model,
      source: body.source,
      metadata: body.metadata,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create chat media asset';
    const status = /Unsupported|Missing|Invalid|MIME/.test(message) ? 400 : 500;
    if (status >= 500) {
      console.error('[chat/media-assets] Error:', error);
    }
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
