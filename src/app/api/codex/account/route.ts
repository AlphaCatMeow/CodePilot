/**
 * GET /api/codex/account
 *
 * Phase 5 Phase 2 (2026-05-13) — surface Codex account state to UI.
 * Returns the narrowed `CodexAccountState` discriminated union. The
 * Settings status card branches on `kind`:
 *
 *   - logged_out → show "Login to Codex" button (POSTs /api/codex/login)
 *   - logged_in  → show account email + plan + "Logout" button
 *   - unknown    → app-server not initialized yet; show retry hint
 *
 * Query param `refresh=1` forces a token refresh through Codex's
 * built-in refresh path. Default is cache-friendly read.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { readCodexAccount } from '@/lib/codex/account';

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  try {
    const state = await readCodexAccount(refresh);
    return NextResponse.json({ state });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { state: { kind: 'unknown' as const }, error: reason },
      { status: 200 },
    );
  }
}

export async function DELETE() {
  try {
    const { logoutCodex } = await import('@/lib/codex/account');
    await logoutCodex();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: reason }, { status: 500 });
  }
}
