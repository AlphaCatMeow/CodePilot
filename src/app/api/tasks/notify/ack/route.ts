import { NextRequest, NextResponse } from 'next/server';

/**
 * Phase 3 Step 3 — delivery ack.
 *
 * Renderer / Electron bg-poller / Bridge channels POST here after
 * actually displaying a notification (or failing to). v5 plan locks
 * the semantics: this route MUST be UPSERT, never INSERT a duplicate.
 * `upsertNotificationDelivery` writes the row only if it doesn't exist,
 * otherwise updates the existing row's status + error + acked_at. The
 * DB layer also has a `UNIQUE(event_id, channel)` constraint as a
 * second safety net.
 *
 * State transition rules (enforced inside the helper):
 *   - queued / not_configured / skipped → delivered / error: allowed
 *   - delivered → error or error → delivered: rejected (a stale ack
 *     can't flip a previously-confirmed terminal state)
 *   - same terminal state re-acked: idempotent no-op (returns true)
 *
 * Returns `{ ok: true, written: <bool> }` where `written=false` means
 * the call was rejected by the state-transition guard. Renderer can
 * use this to log a soft warning without bothering the user.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event_id, channel, status, error } = body as {
      event_id?: string;
      channel?: string;
      status?: string;
      error?: string;
    };

    if (!event_id || !channel || !status) {
      return NextResponse.json(
        { error: 'event_id, channel and status are required' },
        { status: 400 },
      );
    }

    const validStatuses = new Set(['queued', 'delivered', 'error', 'not_configured', 'skipped']);
    if (!validStatuses.has(status)) {
      return NextResponse.json(
        { error: `status must be one of ${[...validStatuses].join(' | ')}` },
        { status: 400 },
      );
    }

    const { upsertNotificationDelivery } = await import('@/lib/db');
    const written = upsertNotificationDelivery({
      event_id,
      channel,
      status: status as 'queued' | 'delivered' | 'error' | 'not_configured' | 'skipped',
      error: error ?? null,
    });

    return NextResponse.json({ ok: true, written });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
