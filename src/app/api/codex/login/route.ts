/**
 * POST /api/codex/login
 *
 * Phase 5 Phase 2 (2026-05-13) — kick off a Codex login flow. The UI
 * caller opens the returned `authUrl` (or shows `verificationUrl` +
 * `userCode` for device code) and then listens for the completion
 * event via /api/codex/account polling.
 *
 * Body (all optional, default = chatgpt streamlined):
 *   - `{ "kind": "chatgpt" }`
 *   - `{ "kind": "chatgptDeviceCode" }`
 *   - `{ "kind": "apiKey", "apiKey": "sk-..." }`
 *
 * Returns the discriminated `CodexLoginStart` shape.
 *
 * Cancel an in-flight login by calling DELETE with the loginId.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { startCodexLogin, cancelCodexLogin } from '@/lib/codex/account';

interface LoginBody {
  kind?: 'chatgpt' | 'chatgptDeviceCode' | 'apiKey';
  apiKey?: string;
}

export async function POST(request: NextRequest) {
  let body: LoginBody = {};
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    // Empty body is fine — default to chatgpt streamlined.
  }

  try {
    if (body.kind === 'apiKey') {
      if (!body.apiKey || typeof body.apiKey !== 'string') {
        return NextResponse.json(
          { error: 'apiKey login requires `apiKey` string in body' },
          { status: 400 },
        );
      }
      const result = await startCodexLogin({ kind: 'apiKey', apiKey: body.apiKey });
      return NextResponse.json({ login: result });
    }
    if (body.kind === 'chatgptDeviceCode') {
      const result = await startCodexLogin({ kind: 'chatgptDeviceCode' });
      return NextResponse.json({ login: result });
    }
    const result = await startCodexLogin({ kind: 'chatgpt' });
    return NextResponse.json({ login: result });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const loginId = request.nextUrl.searchParams.get('loginId');
  if (!loginId) {
    return NextResponse.json({ error: 'loginId required' }, { status: 400 });
  }
  try {
    await cancelCodexLogin(loginId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: reason }, { status: 500 });
  }
}
