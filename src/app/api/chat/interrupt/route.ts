import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/interrupt — Interrupt an active session.
 *
 * We don't know which runtime owns this session, so fan out best-effort to
 * EVERY interruptable runtime. One runtime erroring must not stop the others:
 * - Native:        AbortController-based interrupt
 * - Codex Runtime: turn/interrupt against the active Codex app-server turn
 *                  (codex-stop-recovery Phase 1 — previously missing, so a
 *                  Stop under Codex never reached the backend turn; the turn
 *                  kept running, the stream never closed, and the session lock
 *                  renewed forever → "Stop 后无法发送新指令")
 * - SDK:           conversation.interrupt() on the CLI subprocess
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // Native + Codex runtimes share the registry import. Each is independently
    // try/caught so a missing/erroring runtime can't block the next one.
    const attempted: Record<string, boolean> = { native: false, codex_runtime: false, sdk: false };

    try {
      const { getRuntime } = await import('@/lib/runtime');

      // Try native runtime (AbortController)
      try {
        const nativeRt = getRuntime('native');
        if (nativeRt) {
          nativeRt.interrupt(sessionId);
          attempted.native = true;
        }
      } catch { /* native not available */ }

      // Try Codex runtime (turn/interrupt). interrupt() is best-effort and
      // no-ops when there's no active turn for this session (race against
      // turn/start resolving, or turn already finished).
      try {
        const codexRt = getRuntime('codex_runtime');
        if (codexRt) {
          codexRt.interrupt(sessionId);
          attempted.codex_runtime = true;
        }
      } catch { /* codex not available */ }
    } catch { /* runtime registry not available */ }

    // Try SDK runtime (conversation.interrupt)
    try {
      const { getConversation } = await import('@/lib/conversation-registry');
      const conversation = getConversation(sessionId);
      if (conversation) {
        await conversation.interrupt();
        attempted.sdk = true;
      }
    } catch { /* SDK not available */ }

    // Diagnostic breadcrumb only — never logs prompt / files / credentials.
    console.debug('[interrupt] fan-out', { sessionId, attempted });

    return NextResponse.json({ interrupted: true });
  } catch (error) {
    console.error('[interrupt] Failed to interrupt:', error);
    return NextResponse.json({ interrupted: false, error: String(error) });
  }
}
