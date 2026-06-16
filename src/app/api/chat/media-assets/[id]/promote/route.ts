import { NextRequest, NextResponse } from 'next/server';
import { promoteChatMediaAsset } from '@/lib/chat-media-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = promoteChatMediaAsset(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[chat/media-assets/promote] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to promote chat media asset';
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
