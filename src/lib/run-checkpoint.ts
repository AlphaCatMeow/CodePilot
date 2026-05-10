/**
 * Run Checkpoint trust layer — the single source of truth for "Agent
 * is waiting for the user to confirm something before this send"
 * banners on the chat page.
 *
 * Active reasons (Round 1 + Round 2):
 *   - no-compatible-provider     — no provider can run the resolved pair
 *   - pinned-invalid             — Pinned default unreachable under runtime
 *   - runtime-fallback           — Claude Code SDK requested but Native in use
 *   - context-cost-change        — pending tokens crossed an attention threshold
 *   - permission-elevation       — full-access permission, first send this session
 *
 * Future rounds (see `docs/exec-plans/active/chat-run-checkpoint.md`)
 * will extend `CheckpointReasonId` with `dangerous-tool-call` (Round 3,
 * touches the tool-execution state machine).
 *
 * Design rules:
 *   - Banner only — never modal, never wizard, never settings toggle
 *   - One single primary action per banner
 *   - Returns [] when nothing's waiting → composer renders nothing
 *   - `requiresConfirm` reasons block the send until the action runs
 *
 * Pure data, no React. The component renders this list one-for-one.
 */

export type CheckpointReasonId =
  | 'no-compatible-provider'
  | 'pinned-invalid'
  | 'runtime-fallback'
  | 'context-cost-change'
  | 'permission-elevation';

export type CheckpointTone = 'error' | 'warning' | 'info';

/**
 * Action verbs the renderer understands. `'open-...'` ones map to a
 * settings hash navigation. `'confirm-...'` ones map to "complete the
 * pending send" — the calling page wires these to MessageInput's
 * imperative submit channel via the `onAction` prop on `<RunCheckpoint>`.
 */
export type CheckpointActionId =
  | 'open-providers'
  | 'open-runtime'
  | 'confirm-context-cost'
  | 'confirm-permission-elevation';

export interface CheckpointAction {
  /** i18n key for the button label. Resolved by the renderer. */
  labelKey: string;
  /** Settings route to navigate to (e.g. `'/settings/runtime'`). The
   *  renderer turns this into a router.push or window.location nav.
   *  Use the route-level path so the user lands directly in the section
   *  without paying the redirect-from-root recompile cost. */
  href?: string;
  /** Optional explicit handler — wins over `href` if both provided. */
  onClick?: () => void;
  /** Action verb the calling page can intercept. Used for
   *  `confirm-...` reasons that don't navigate but unblock a
   *  pending send. */
  actionId?: CheckpointActionId;
}

export interface CheckpointReason {
  id: CheckpointReasonId;
  tone: CheckpointTone;
  /** i18n key for the title (always shown). */
  titleKey: string;
  /** i18n key for the description (optional). */
  descriptionKey?: string;
  /** Interpolation values for the description key. */
  descriptionValues?: Record<string, string | number>;
  /** Single primary action. Round 1 enforces "one action per banner"
   *  to keep the user's eye-path linear (see plan §B). */
  action?: CheckpointAction;
  /**
   * When true, MessageInput must block the send until the user takes
   * the banner's action. Round 2 added this for context-cost-change
   * and permission-elevation: those reasons gate the next message,
   * the action button confirms-and-sends. The other Round 1 reasons
   * are informational + already gate via `MessageInput.disabled` on
   * other state, so they don't set this flag.
   */
  requiresConfirm?: boolean;
}

export interface BuildCheckpointsOpts {
  /** Session-scoped: the picker couldn't resolve a provider/model
   *  pair under the active runtime. Always required because every
   *  RunCheckpoint surface needs to be able to express it. */
  noCompatibleProvider: boolean;
  /** Pinned-default invalid. Optional because chat first-paint surfaces
   *  use only the local runtime-aware resolver result here, and existing
   *  sessions ignore the global pin entirely. Settings / Health pages
   *  may still pass `true` from `useOverviewData().defaultInvalid` when
   *  surfacing global health. Defaults to `false`. */
  defaultInvalid?: boolean;
  /** Global "user asked for SDK but CLI fell back to native" notice.
   *  Optional because the chat surfaces dropped this signal entirely
   *  (it's global health, not session blocking — see
   *  `chat-static-graph.test.ts` for the contract). Settings / Health
   *  pages still drive it from `useOverviewData` + `useClaudeStatus`.
   *  Defaults to `false`. */
  runtimeFallback?: boolean;
  /** Human-readable "Anthropic / sonnet-4-5" for the pinned-invalid
   *  banner. Renderer interpolates into the description.
   *  Undefined → renders as "?" placeholder. */
  pinnedDescriptor?: string;
  /**
   * Round 2 — context-cost-change trigger inputs. `pendingContextTokens`
   * is the sum of @ mentions + + directories + PromptInput attachments.
   * `usedContextTokens` is what the model has already consumed in the
   * current session (from `useContextUsage().used`).
   * Defaults to 0 — page can omit when not on a session.
   */
  pendingContextTokens?: number;
  usedContextTokens?: number;
  /**
   * Round 2 — permission-elevation trigger. The page computes:
   *   permissionElevationPending =
   *     permissionProfile === 'full_access' &&
   *     !sessionAlreadyConfirmedFullAccess
   * and passes the boolean here. The session-confirmed flag belongs
   * to the page (it survives across MessageInput re-renders but
   * resets when the user toggles permission off then on again).
   */
  permissionElevationPending?: boolean;
}

/** Pending tokens cap that always triggers the banner regardless of used. */
export const CONTEXT_COST_PENDING_HARD = 10_000;
/** Ratio of pending / used that triggers the banner when used > 0. */
export const CONTEXT_COST_PENDING_RATIO = 0.3;

/**
 * Whether the current pending vs used context tokens warrants the
 * "this send will add a lot of context" banner.
 *
 *   - pending >= 10K                                   → trigger
 *   - used > 0 AND pending / used >= 30%               → trigger
 *   - used === 0 AND pending < 10K                     → no trigger
 *     (no banner for tiny first-send context)
 *
 * Returns the *trigger* boolean — caller composes the reason itself.
 */
export function shouldTriggerContextCost(
  pendingContextTokens: number,
  usedContextTokens: number,
): boolean {
  if (pendingContextTokens >= CONTEXT_COST_PENDING_HARD) return true;
  if (usedContextTokens > 0 && pendingContextTokens / usedContextTokens >= CONTEXT_COST_PENDING_RATIO) {
    return true;
  }
  return false;
}

/**
 * Decide which checkpoints are active right now. Order in the returned
 * array determines render order — most blocking first.
 *
 * Precedence: noCompatibleProvider supersedes everything else because
 * if there's no provider at all, downstream reasons are noise. The
 * other reasons are additive — pinned-invalid + runtime-fallback +
 * context-cost can all stack if their triggers fire together.
 *
 * Round 1 reasons (no-provider / pinned-invalid / runtime-fallback)
 * never set `requiresConfirm`: they're informational, and MessageInput's
 * existing `disabled` gate handles the pinned/no-provider blocks.
 * Round 2 reasons (context-cost / permission-elevation) DO set it,
 * because the user may legitimately want to send the message after
 * acknowledging the cost / permission.
 */
export function buildCheckpoints(opts: BuildCheckpointsOpts): CheckpointReason[] {
  const out: CheckpointReason[] = [];

  if (opts.noCompatibleProvider) {
    out.push({
      id: 'no-compatible-provider',
      tone: 'error',
      titleKey: 'runCheckpoint.noProvider.title',
      descriptionKey: 'runCheckpoint.noProvider.description',
      action: {
        labelKey: 'runCheckpoint.noProvider.action',
        href: '/settings/providers',
        actionId: 'open-providers',
      },
    });
    return out;
  }

  if (opts.defaultInvalid) {
    out.push({
      id: 'pinned-invalid',
      tone: 'error',
      titleKey: 'runCheckpoint.pinnedInvalid.title',
      descriptionKey: 'runCheckpoint.pinnedInvalid.description',
      descriptionValues: { pinned: opts.pinnedDescriptor || '?' },
      action: {
        labelKey: 'runCheckpoint.pinnedInvalid.action',
        href: '/settings/runtime',
        actionId: 'open-runtime',
      },
    });
  }

  if (opts.runtimeFallback) {
    out.push({
      id: 'runtime-fallback',
      tone: 'warning',
      titleKey: 'runCheckpoint.runtimeFallback.title',
      descriptionKey: 'runCheckpoint.runtimeFallback.description',
      action: {
        labelKey: 'runCheckpoint.runtimeFallback.action',
        href: '/settings/runtime',
        actionId: 'open-runtime',
      },
    });
  }

  // Round 2 — context-cost-change. Blocks the send until the user
  // confirms via the action. After send, pending → 0 and the trigger
  // un-fires, so no need for a "confirmed this" persistent flag.
  const pending = opts.pendingContextTokens ?? 0;
  const used = opts.usedContextTokens ?? 0;
  if (shouldTriggerContextCost(pending, used)) {
    out.push({
      id: 'context-cost-change',
      tone: 'info',
      titleKey: 'runCheckpoint.contextCost.title',
      descriptionKey: 'runCheckpoint.contextCost.description',
      descriptionValues: {
        pending: formatTokensForBanner(pending),
        used: used > 0 ? formatTokensForBanner(used) : '0',
      },
      action: {
        labelKey: 'runCheckpoint.contextCost.action',
        actionId: 'confirm-context-cost',
      },
      requiresConfirm: true,
    });
  }

  // Round 2 — permission-elevation. Triggers on FIRST send under
  // full_access in this session; the page tracks "confirmed" state
  // separately and clears the pending flag once the user acknowledges.
  if (opts.permissionElevationPending) {
    out.push({
      id: 'permission-elevation',
      tone: 'warning',
      titleKey: 'runCheckpoint.permissionElevation.title',
      descriptionKey: 'runCheckpoint.permissionElevation.description',
      action: {
        labelKey: 'runCheckpoint.permissionElevation.action',
        actionId: 'confirm-permission-elevation',
      },
      requiresConfirm: true,
    });
  }

  return out;
}

/** "12.3K" / "850" formatting — stays inline so unit tests can drive it. */
function formatTokensForBanner(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(Math.round(n));
}
