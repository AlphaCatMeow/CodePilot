/**
 * GET /api/codex/models
 *
 * Phase 5 Phase 2 (2026-05-13) — list Codex Account models for UI
 * pickers. Returns the same `ProviderModelGroup` shape used by the
 * unified `/api/providers/models` endpoint, so the chat picker can
 * render Codex Account alongside other providers.
 *
 * Returns `{ group: null }` when no models are available (account
 * not logged in or app-server unavailable). Callers (Settings
 * status card) read /api/codex/status separately to know why.
 *
 * Query param `refresh=1` bypasses the in-process 30s cache.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { buildCodexProviderModelGroup, invalidateCodexModelsCache } from '@/lib/codex/models';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('refresh') === '1') {
    invalidateCodexModelsCache();
  }
  try {
    const group = await buildCodexProviderModelGroup();
    return NextResponse.json({ group });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ group: null, error: reason }, { status: 200 });
  }
}
