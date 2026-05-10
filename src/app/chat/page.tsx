'use client';

import { Suspense, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Message, SSEEvent, SessionResponse, TokenUsage, PermissionRequestEvent, FileAttachment, MentionRef } from '@/types';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput } from '@/components/chat/MessageInput';
import { ChatComposerActionBar } from '@/components/chat/ChatComposerActionBar';
import { ModeIndicator } from '@/components/chat/ModeIndicator';
import { ChatPermissionSelector } from '@/components/chat/ChatPermissionSelector';
import { RuntimeSelector } from '@/components/chat/RuntimeSelector';
import { chatRuntimeParamForSession } from '@/lib/chat-runtime-shared';
import type { ChatRuntime } from '@/lib/chat-runtime-shared';
import { PermissionPrompt } from '@/components/chat/PermissionPrompt';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { RunCockpit } from '@/components/chat/RunCockpit';
import { RunCheckpoint } from '@/components/chat/RunCheckpoint';
import { OnboardingWizard } from '@/components/assistant/OnboardingWizard';
import { ErrorBanner } from '@/components/ui/error-banner';
import { buildCheckpoints } from '@/lib/run-checkpoint';
// Chat first-paint memory contract (2026-05-09): NewChatPage must NOT
// statically reach `useOverviewData` (full Settings overview snapshot,
// fans out to 6+ /api endpoints + transitively pulls runtime/effective
// + provider-catalog). RunCheckpoint now only carries session-scoped
// "can this send go through" reasons; full health signals belong to
// /settings/health and the lazy RunCockpit popover. RuntimeSelector
// only needs the global agent_runtime label, which the lightweight
// hook below fetches from /api/settings/app alone.
// `computeEffectiveRuntime` and `useClaudeStatus` were here ONLY to
// compute `runtimeFallback` for the checkpoint banner — that signal
// was global health, not session blocking, so it's no longer surfaced
// at the chat first-paint. See chat-static-graph.test.ts.
import { useGlobalAgentRuntime } from '@/hooks/useGlobalAgentRuntime';
import { FolderPicker } from '@/components/chat/FolderPicker';
import { useNativeFolderPicker } from '@/hooks/useNativeFolderPicker';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import { maybeShowStatusToast } from '@/hooks/useSSEStream';
import { seedSnapshotPatch } from '@/lib/stream-session-manager';
// `runtime/effective` stays — it's needed for the local resolver effect
// that produces `invalidDefault` (runtime-aware pinned-default check).
// That's the only contributor to RunCheckpoint's pinned-invalid
// reason on the new-chat page.
import { resolveNewChatDefault } from '@/lib/runtime/effective';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export default function NewChatPage() {
  // useSearchParams in App Router needs a Suspense boundary. The body of
  // NewChatPage was previously reading window.location.search inside a
  // `useMemo([])` to avoid that wrapper, but `useMemo([])` only runs once
  // per mount, so URL changes after mount (e.g. router.push to
  // /chat?prefill=… while /chat is already mounted, or back-forward
  // navigation) didn't update `prefillText`. Result: Tasks page → "新建任务"
  // could land on /chat with the prefill query in the URL but an empty
  // textarea. Suspense + useSearchParams makes prefill reactive without
  // breaking SSR/static prerender.
  return (
    <Suspense fallback={null}>
      <NewChatPageInner />
    </Suspense>
  );
}

function NewChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillText = searchParams.get('prefill') || '';
  const { setPendingApprovalSessionId } = usePanel();
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinkingContent, setStreamingThinkingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolUses, setToolUses] = useState<ToolUseInfo[]>([]);
  const [toolResults, setToolResults] = useState<ToolResultInfo[]>([]);
  const [statusText, setStatusText] = useState<string | undefined>();
  const [workingDir, setWorkingDir] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{ message: string; description?: string } | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [hasProvider, setHasProvider] = useState(true); // assume true until checked
  // True when the runtime-filtered /api/providers/models call succeeded
  // but returned an empty list — i.e. user has providers configured but
  // none are compatible with the active runtime. Distinct from
  // !hasProvider (no provider at all). Send is gated, picker shows empty.
  const [noCompatibleProvider, setNoCompatibleProvider] = useState(false);
  // Phase 2C contract: when global_default_mode='pinned' AND the pinned
  // provider/model isn't reachable under the effective Runtime, we set
  // this state to block sends. We DO NOT silently substitute another
  // provider/model — that's the entire point of pinning. Recovery
  // actions (switch Runtime / enable model / pick new / revert to Auto)
  // live on the Runtime page banner (Phase 2C.3) + Health page (2C.5);
  // here we just gate send + surface a minimal inline notice.
  const [invalidDefault, setInvalidDefault] = useState<
    | {
        providerId?: string;
        providerName?: string;
        modelValue?: string;
        reason?: 'provider-missing' | 'model-missing' | 'pin-incomplete';
      }
    | null
  >(null);
  const [showWizard, setShowWizard] = useState(false);
  const [assistantConfigured, setAssistantConfigured] = useState(false);
  const [assistantWorkspacePath, setAssistantWorkspacePath] = useState('');
  const [mode, setMode] = useState('code');
  // Model/provider start empty — populated by the async global-default fetch.
  // This prevents the race where a user sends before the fetch completes and
  // gets the stale localStorage model instead of the configured default.
  const [modelReady, setModelReady] = useState(false);
  const [currentModel, setCurrentModel] = useState(() => {
    if (typeof window === 'undefined') return '';
    // One-time migration: clear stale model/provider from pre-0.38 installs
    if (!localStorage.getItem('codepilot:migration-038')) {
      localStorage.removeItem('codepilot:last-model');
      localStorage.removeItem('codepilot:last-provider-id');
      localStorage.setItem('codepilot:migration-038', '1');
    }
    return '';
  });
  const [currentProviderId, setCurrentProviderId] = useState(() => {
    if (typeof window === 'undefined') return '';
    if (!localStorage.getItem('codepilot:migration-038')) {
      return '';
    }
    return '';
  });
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent | null>(null);
  const [permissionResolved, setPermissionResolved] = useState<'allow' | 'deny' | null>(null);
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [permissionProfile, setPermissionProfile] = useState<'default' | 'full_access'>('default');
  const [pendingContextTokens, setPendingContextTokens] = useState(0);

  // Round 2 — permission-elevation confirmation, scoped to this
  // session. `null` while the user hasn't ack'd; `'full_access'` once
  // they confirm via the banner. Auto-resets to `null` whenever the
  // permission profile leaves full_access, so toggling back ON
  // re-arms the banner.
  const [permissionElevationConfirmedFor, setPermissionElevationConfirmedFor] =
    useState<'full_access' | null>(null);
  useEffect(() => {
    if (permissionProfile !== 'full_access') {
      setPermissionElevationConfirmedFor(null);
    }
  }, [permissionProfile]);

  // Phase 2 Step 4c — runtime pin for the not-yet-created session.
  // RuntimeSelector writes here; on first send we PATCH the new
  // session row with this value before the chat POST runs (so the
  // chat route's lazy-seed sees the user's choice instead of falling
  // through to the global default). Empty string = follow global.
  // **Hoisted above checkpointReasons** because round-2 review needs
  // the value inside the checkpoint memo (suppressing stale
  // overview.defaultInvalid under explicit override) AND inside the
  // resolver effects (mode override) — declaring it after would TDZ.
  const [runtimePin, setRuntimePin] = useState<string>('');
  // Round-1 review fix — derive the chat-runtime param up front so
  // the default-resolver fetches and effect deps can both stay in
  // sync when the user switches runtime mid-page. Hardcoded `'auto'`
  // would lock the validation to mount-time runtime even after a
  // pick, leaving invalidDefault / noCompatibleProvider stale and
  // the red RunCheckpoint banner up after the model picker had
  // already corrected itself.
  const sessionRuntimeParam = chatRuntimeParamForSession(runtimePin);

  // Run Checkpoint signals — session-scoped only, no global health.
  //
  // Phase 2 originally pulled the full `useOverviewData()` snapshot
  // here so RunCheckpoint and RunCockpit could "agree on the same
  // numbers". That coupling cost the chat first paint a fan-out of
  // /api fetches plus a static compile-graph reach into Settings
  // Overview / runtime/effective / provider catalog. The 2026-05-09
  // memory cut moves global health (provider count / models enabled /
  // workspace state / global default invalid / runtime fallback) out
  // of this surface entirely — RunCockpit's lazy popover still shows
  // them when the user opens it, /settings/health is the canonical
  // dashboard. RunCheckpoint here keeps only the reasons that gate
  // "can this send go through":
  //   - noCompatibleProvider:        local state, set when the picker
  //                                   can't find a provider/model pair
  //                                   under the active runtime
  //   - !!invalidDefault:            local state from the runtime-aware
  //                                   resolver effect (NOT OR'd with
  //                                   any global flag — under explicit
  //                                   pin the local check is canonical;
  //                                   under follow-default it's the
  //                                   runtime-aware substitute for the
  //                                   global pinned check)
  //   - context-cost + permission-elevation: per-send confirmation
  //                                   gates, unrelated to runtime
  //
  // /chat (new conversation page) hasn't accumulated messages yet, so
  // usedContextTokens is 0 — the context-cost trigger collapses to the
  // 10K hard cap on the pending side.
  const usedContextTokens = 0;
  const checkpointReasons = useMemo(() => {
    const pinnedDescriptor = invalidDefault?.modelValue
      ? `${invalidDefault.providerName ?? invalidDefault.providerId ?? '?'} / ${invalidDefault.modelValue}`
      : invalidDefault?.providerId ?? undefined;
    const permissionElevationPending =
      permissionProfile === 'full_access' &&
      permissionElevationConfirmedFor !== 'full_access';
    return buildCheckpoints({
      noCompatibleProvider,
      defaultInvalid: !!invalidDefault,
      pinnedDescriptor,
      pendingContextTokens,
      usedContextTokens,
      permissionElevationPending,
    });
  }, [
    invalidDefault,
    noCompatibleProvider,
    pendingContextTokens,
    usedContextTokens,
    permissionProfile,
    permissionElevationConfirmedFor,
  ]);
  // RuntimeSelector display fallback — when the session has no
  // explicit pin, show the current global runtime so the user sees
  // a concrete name instead of a hedge. Lightweight hook (single
  // /api/settings/app fetch) keeps this surface off the heavy
  // overview path; the heavy popover content uses `useOverviewData`
  // when actually opened.
  const globalRuntime = useGlobalAgentRuntime();
  const blockingReasonIds = useMemo(
    () => checkpointReasons.filter((r) => r.requiresConfirm).map((r) => r.id),
    [checkpointReasons],
  );
  const handleCheckpointAction = useCallback((actionId: string) => {
    if (actionId === 'confirm-permission-elevation') {
      setPermissionElevationConfirmedFor('full_access');
    }
    // Both Round 2 confirms unblock the pending send; MessageInput
    // listens for this event and re-runs submit with bypass=true.
    if (actionId === 'confirm-context-cost' || actionId === 'confirm-permission-elevation') {
      window.dispatchEvent(new Event('run-checkpoint-confirm-send'));
    }
  }, []);
  const [createdSessionId, setCreatedSessionId] = useState<string | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);
  // Effort level — lifted here so the first message includes it
  const [selectedEffort, setSelectedEffort] = useState<string | undefined>(undefined);
  // Provider options (thinking mode + 1M context)
  const [thinkingMode, setThinkingMode] = useState<string>('adaptive');
  const [context1m, setContext1m] = useState(false);

  // Fetch provider-specific options (with abort to prevent stale responses on fast switch)
  useEffect(() => {
    const pid = currentProviderId || 'env';
    const controller = new AbortController();
    fetch(`/api/providers/options?providerId=${encodeURIComponent(pid)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!controller.signal.aborted) {
          setThinkingMode(data?.options?.thinking_mode || 'adaptive');
          setContext1m(!!data?.options?.context_1m);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [currentProviderId]);

  // Validate restored model/provider against actual available providers/models.
  // For NEW conversations, the global default model takes priority
  // over localStorage's last-model (which is a cross-session global memory).
  useEffect(() => {
    let cancelled = false;

    // Step 4c round 1 review — re-run on `sessionRuntimeParam` change
    // (was `[]` before, runtime-pin flips just updated the picker hook
    // and left the rest stale: red RunCheckpoint stayed up, send button
    // stayed disabled). Reset `modelReady` for the duration of the new
    // fetch so consumers see a definite "still resolving" beat instead
    // of the previous run's verdict.
    setModelReady(false);

    // Fetch models filtered by the **current** session runtime param —
    // empty pin → 'auto' (server resolves), explicit pin → that value
    // exactly. Without this the user-picked runtime never feeds back
    // into invalidDefault / noCompatibleProvider, and the resolved pair
    // could lock onto a provider the new runtime can't reach.
    const modelsP = fetch(`/api/providers/models?runtime=${sessionRuntimeParam}`).then(r => r.ok ? r.json() : null);
    const globalP = fetch('/api/providers/options?providerId=__global__').then(r => r.ok ? r.json() : null);

    Promise.all([modelsP, globalP]).then(([modelsData, globalData]) => {
      if (cancelled) return;
      // Three outcomes from a runtime-filtered fetch:
      //   1. API unreachable / malformed → fall back to localStorage so
      //      the picker still has *something* to show.
      //   2. Groups present → run validation chain below.
      //   3. Groups present but empty array → meaningful "no provider
      //      compatible with the active runtime" state. Don't restore
      //      the saved provider/model from localStorage — that would
      //      put back the very combination the runtime gate just
      //      filtered out. Clear and let the empty-state UI surface.
      if (!modelsData?.groups) {
        const savedModel = localStorage.getItem('codepilot:last-model') || 'sonnet';
        const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
        setCurrentModel(savedModel);
        setCurrentProviderId(savedProvider);
        setModelReady(true);
        return;
      }
      // Phase 2C: resolver branches on default_mode (Auto vs Pinned).
      // Auto walks the savedPair → apiDefault → first chain; Pinned
      // demands an exact match and returns 'invalid-default' otherwise.
      // No silent substitution for Pinned — see invalidDefault state.
      //
      // Step 4c round 2 — when the user has explicitly switched runtime
      // via RuntimeSelector (`runtimePin !== ''`), the global pinned
      // policy no longer reflects their intent for THIS conversation:
      // they've actively asked for a different runtime, so blocking
      // them on a global pinned default that's incompatible with that
      // runtime forces them to "fix global settings" when the right
      // answer is "use the picker's auto-resolved pair under the new
      // runtime". Treat this case as 'auto' mode so the resolver
      // walks savedPair → apiDefault → first instead of demanding the
      // global pinned. When `runtimePin === ''` (still following the
      // global runtime), keep the strict pinned semantics — the
      // memory rule "pinned default is a hard promise" still holds
      // for that path.
      const opts = globalData?.options;
      const effectiveMode: 'pinned' | 'auto' = runtimePin
        ? 'auto'
        : (opts?.default_mode === 'pinned' ? 'pinned' : 'auto');
      const resolved = resolveNewChatDefault({
        groups: modelsData.groups,
        apiDefaultProviderId: modelsData.default_provider_id,
        mode: effectiveMode,
        pinnedProviderId: opts?.default_model_provider || '',
        pinnedModel: opts?.default_model || '',
        savedProviderId: localStorage.getItem('codepilot:last-provider-id') || '',
        savedModel: localStorage.getItem('codepilot:last-model') || '',
      });

      if (resolved.status === 'no-compatible') {
        setCurrentModel('');
        setCurrentProviderId('');
        setNoCompatibleProvider(true);
        setInvalidDefault(null);
      } else if (resolved.status === 'invalid-default') {
        // Pinned + unreachable — block, surface, do not substitute.
        setCurrentModel('');
        setCurrentProviderId('');
        setNoCompatibleProvider(false);
        setInvalidDefault({
          providerId: resolved.providerId,
          providerName: resolved.providerName,
          modelValue: resolved.modelValue,
          reason: resolved.reason,
        });
      } else {
        // 'ok' (Pinned valid) or 'auto-resolved' (Auto chain found one).
        setCurrentProviderId(resolved.providerId ?? '');
        setCurrentModel(resolved.modelValue ?? '');
        setNoCompatibleProvider(false);
        setInvalidDefault(null);
      }
      setModelReady(true);
    }).catch(() => {
      // Fetch failed — fall back to localStorage best-effort
      const savedModel = localStorage.getItem('codepilot:last-model') || 'sonnet';
      const savedProvider = localStorage.getItem('codepilot:last-provider-id') || '';
      setCurrentModel(savedModel);
      setCurrentProviderId(savedProvider);
      setModelReady(true);
    });

    return () => { cancelled = true; };

  }, [sessionRuntimeParam]); // Re-validate whenever the runtime selector flips

  // Initialize workingDir from localStorage (or setup default), validating the path exists
  useEffect(() => {
    let cancelled = false;

    const validateDir = async (path: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/files/browse?dir=${encodeURIComponent(path)}`);
        return res.ok;
      } catch {
        return false;
      }
    };

    const tryFallbackToDefault = async () => {
      try {
        const res = await fetch('/api/setup');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data?.defaultProject) return;
        if (await validateDir(data.defaultProject) && !cancelled) {
          setWorkingDir(data.defaultProject);
          localStorage.setItem('codepilot:last-working-directory', data.defaultProject);
        }
      } catch { /* ignore */ }
    };

    const init = async () => {
      const saved = localStorage.getItem('codepilot:last-working-directory');
      if (saved) {
        if (await validateDir(saved) && !cancelled) {
          setWorkingDir(saved);
        } else if (!cancelled) {
          // Stale — clear and try setup default
          localStorage.removeItem('codepilot:last-working-directory');
          await tryFallbackToDefault();
        }
      } else {
        await tryFallbackToDefault();
      }
    };

    init();

    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) setWorkingDir(path);
    };
    window.addEventListener('project-directory-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('project-directory-changed', handler);
    };
  }, []);

  // Load recent projects for empty state
  useEffect(() => {
    fetch('/api/setup/recent-projects')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(data => setRecentProjects(data.projects || []))
      .catch(() => {});
  }, []);

  // Detect assistant workspace status
  useEffect(() => {
    fetch('/api/settings/workspace')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.path && data?.valid !== false) {
          setAssistantWorkspacePath(data.path);
          setAssistantConfigured(!!data.state?.onboardingComplete);
        }
      })
      .catch(() => {});
  }, []);

  // Check provider availability — only 'completed' counts, 'skipped' means user deferred but has no real credentials
  useEffect(() => {
    const checkProvider = () => {
      // Lock sending while we re-resolve the model/provider
      setModelReady(false);
      fetch('/api/setup')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setHasProvider(data.provider === 'completed');
          }
        })
        .catch(() => {});
      // Sync provider/model, applying global default model for new conversations.
      const savedProviderId = localStorage.getItem('codepilot:last-provider-id');

      // Fetch models + global default in parallel. Same runtime gating as
      // the initial-load branch above: server filters by the **current**
      // session runtime param (Step 4c round 1 review fix — was hardcoded
      // 'auto'; that locked the saved-provider validation to whatever
      // runtime resolved at mount even after the user switched it).
      const modelsP = fetch(`/api/providers/models?runtime=${sessionRuntimeParam}`).then(r => r.ok ? r.json() : null);
      const globalP = fetch('/api/providers/options?providerId=__global__').then(r => r.ok ? r.json() : null);

      Promise.all([modelsP, globalP]).then(([modelsData, globalData]) => {
        // Distinguish failure (modelsData null) from valid empty result.
        // Failure → keep existing state, just unlock send. Valid empty
        // (runtime filter dropped every group) → clear stale provider/
        // model so we don't leak the just-filtered-out combination back
        // into the picker; UI's empty state surfaces "no compatible
        // provider for this runtime".
        if (!modelsData?.groups) {
          setModelReady(true);
          return;
        }
        // Phase 2C: same shared resolver as the initial-load branch.
        // 'no-compatible' / 'invalid-default' / 'ok' / 'auto-resolved' —
        // no silent substitution for Pinned (see invalidDefault state).
        //
        // Step 4c round 2 — same `runtimePin` override as the
        // initial-load branch above: explicit runtime pick → 'auto'
        // mode, no global-pinned enforcement.
        const opts = globalData?.options;
        const effectiveMode: 'pinned' | 'auto' = runtimePin
          ? 'auto'
          : (opts?.default_mode === 'pinned' ? 'pinned' : 'auto');
        const resolved = resolveNewChatDefault({
          groups: modelsData.groups,
          apiDefaultProviderId: modelsData.default_provider_id,
          mode: effectiveMode,
          pinnedProviderId: opts?.default_model_provider || '',
          pinnedModel: opts?.default_model || '',
          savedProviderId: savedProviderId || '',
          savedModel: localStorage.getItem('codepilot:last-model') || '',
        });

        if (resolved.status === 'no-compatible') {
          setCurrentProviderId('');
          setCurrentModel('');
          setNoCompatibleProvider(true);
          setInvalidDefault(null);
        } else if (resolved.status === 'invalid-default') {
          setCurrentProviderId('');
          setCurrentModel('');
          setNoCompatibleProvider(false);
          setInvalidDefault({
            providerId: resolved.providerId,
            providerName: resolved.providerName,
            modelValue: resolved.modelValue,
            reason: resolved.reason,
          });
        } else {
          setNoCompatibleProvider(false);
          setInvalidDefault(null);
          const resolvedProviderId = resolved.providerId ?? '';
          const resolvedModelValue = resolved.modelValue ?? '';
          setCurrentProviderId(resolvedProviderId);
          setCurrentModel(resolvedModelValue);
          // Side effect specific to this call site: keep localStorage in
          // sync so the next mount doesn't try to restore a saved value
          // that's no longer in any compatible group. The initial-load
          // branch doesn't write back because the user might still have
          // valid state pending a different fetch.
          if (savedProviderId !== null && savedProviderId !== resolvedProviderId) {
            localStorage.removeItem('codepilot:last-provider-id');
          }
          const savedModel = localStorage.getItem('codepilot:last-model');
          if (savedModel !== resolvedModelValue) {
            localStorage.setItem('codepilot:last-model', resolvedModelValue);
          }
        }
        setModelReady(true);
      }).catch(() => {
        // On fetch failure, still apply localStorage values as-is (best effort)
        if (savedProviderId !== null) setCurrentProviderId(savedProviderId);
        const savedModel = localStorage.getItem('codepilot:last-model');
        if (savedModel) setCurrentModel(savedModel);
        setModelReady(true);
      });
    };
    checkProvider();

    window.addEventListener('provider-changed', checkProvider);
    return () => window.removeEventListener('provider-changed', checkProvider);
  }, [sessionRuntimeParam]); // Step 4c round 1 — re-run on runtime pin flip

  const handleSelectFolder = useCallback(async () => {
    if (isElectron) {
      const path = await openNativePicker({ title: t('folderPicker.title') });
      if (path) {
        setWorkingDir(path);
        localStorage.setItem('codepilot:last-working-directory', path);
      }
    } else {
      setFolderPickerOpen(true);
    }
  }, [isElectron, openNativePicker, t]);

  const handleFolderPickerSelect = useCallback((path: string) => {
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
    setFolderPickerOpen(false);
  }, []);

  const handleSelectProject = useCallback((path: string) => {
    setWorkingDir(path);
    localStorage.setItem('codepilot:last-working-directory', path);
  }, []);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handlePermissionResponse = useCallback(async (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => {
    if (!pendingPermission) return;

    const body: { permissionRequestId: string; decision: { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] } | { behavior: 'deny'; message?: string } } = {
      permissionRequestId: pendingPermission.permissionRequestId,
      decision: decision === 'deny'
        ? { behavior: 'deny', message: denyMessage || 'User denied permission' }
        : {
            behavior: 'allow',
            ...(updatedInput ? { updatedInput } : {}),
            ...(decision === 'allow_session' && pendingPermission.suggestions
              ? { updatedPermissions: pendingPermission.suggestions }
              : {}),
          },
    };

    setPermissionResolved(decision === 'deny' ? 'deny' : 'allow');
    setPendingApprovalSessionId('');

    try {
      await fetch('/api/chat/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Best effort
    }

    setTimeout(() => {
      setPendingPermission(null);
      setPermissionResolved(null);
    }, 1000);
  }, [pendingPermission, setPendingApprovalSessionId]);

  const sendFirstMessage = useCallback(
    async (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[]) => {
      if (isStreaming) return;

      // Wait for model/provider to be resolved from the global default before allowing send
      if (!modelReady) return;

      // Block send when the runtime-filtered API returned an empty group
      // list — user has providers but none are compatible with the
      // active runtime. Without this gate, sendFirstMessage would post
      // `model: '', provider_id: ''` to /api/chat/sessions and the server
      // would resolve them via the env-default chain, silently bypassing
      // the runtime gate that just hid every option in the picker.
      if (noCompatibleProvider) {
        setErrorBanner({
          message: t('error.providerUnavailable'),
          description: t('chat.empty.noProvider'),
        });
        return;
      }

      // Phase 2C: pinned default unreachable under effective Runtime →
      // hard block. The persistent banner above MessageInput already
      // names the broken pin and exposes a "Go to Runtime" action; the
      // composer is also disabled so this branch is currently
      // unreachable, but keep the gate as a defensive backstop.
      if (invalidDefault) {
        return;
      }

      // Require a project directory before sending
      if (!workingDir.trim()) {
        setErrorBanner({ message: t('chat.empty.noDirectory') });
        return;
      }

      // Require a provider before sending
      if (!hasProvider) {
        setErrorBanner({
          message: t('error.providerUnavailable'),
          description: t('chat.empty.noProvider'),
        });
        return;
      }

      // Defense in depth: even if other gates pass, never POST an empty
      // model+provider pair — the server would fall back to env defaults
      // and re-introduce the cross-wire we're trying to prevent.
      if (!currentModel || !currentProviderId) {
        setErrorBanner({
          message: t('error.providerUnavailable'),
          description: t('chat.empty.noProvider'),
        });
        return;
      }

      setIsStreaming(true);
      setStreamingContent('');
      setToolUses([]);
      setToolResults([]);
      setStatusText(undefined);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let sessionId = '';

      try {
        // Create a new session with working directory + model/provider
        const createBody: Record<string, string> = {
          title: content.slice(0, 50),
          mode,
          working_directory: workingDir.trim(),
          permission_profile: permissionProfile,
          model: currentModel,
          provider_id: currentProviderId,
        };

        const createRes = await fetch('/api/chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });

        if (!createRes.ok) {
          const errBody = await createRes.json().catch(() => ({}));
          throw new Error(errBody.error || `Failed to create session (${createRes.status})`);
        }

        const { session }: SessionResponse = await createRes.json();
        sessionId = session.id;
        setCreatedSessionId(sessionId);

        // Phase 2 Step 4c — if the user explicitly picked a runtime in
        // the composer's RuntimeSelector before sending, persist it now
        // (before the chat POST runs). This way the chat route's
        // lazy-seed sees `session.runtime_pin` already set and skips the
        // global-default fallback. Awaited so we don't race with /api/chat.
        if (runtimePin) {
          try {
            await fetch(`/api/chat/sessions/${sessionId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ runtime_pin: runtimePin }),
            });
          } catch {
            // Non-fatal — the lazy-seed will still pin to the global
            // default; the user can re-pick from /chat/[id] after redirect.
          }
        }

        // Notify ChatListPanel to refresh immediately
        window.dispatchEvent(new CustomEvent('session-created'));

        // Add user message to UI — use displayOverride for chat bubble if provided
        const displayUserContent = displayOverride || content;
        // Optimistic save preserves base64 `data` so images can render
        // their thumbnail immediately (see ChatView for the full
        // explanation; backend still strips `data` before persistence).
        const contentWithFileMeta = files && files.length > 0
          ? `<!--files:${JSON.stringify(files.map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data })))}-->${displayUserContent}`
          : displayUserContent;
        const userMessage: Message = {
          id: 'temp-' + Date.now(),
          session_id: session.id,
          role: 'user',
          content: contentWithFileMeta,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages([userMessage]);

        // Build thinking config from settings
        const thinkingConfig = thinkingMode && thinkingMode !== 'adaptive'
          ? { type: thinkingMode }
          : thinkingMode === 'adaptive' ? { type: 'adaptive' } : undefined;

        // Send the message via streaming API
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: session.id,
            content,
            mode,
            model: currentModel,
            provider_id: currentProviderId,
            ...(files && files.length > 0 ? { files } : {}),
            ...(mentions && mentions.length > 0 ? { mentions } : {}),
            ...(systemPromptAppend ? { systemPromptAppend } : {}),
            // 'auto' sentinel means "no explicit effort" — omit so Claude
            // Code CLI applies its per-model default (Opus 4.7 → xhigh).
            ...(selectedEffort && selectedEffort !== 'auto' ? { effort: selectedEffort } : {}),
            ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
            ...(context1m ? { context_1m: true } : {}),
            ...(displayOverride ? { displayOverride } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (err?.code === 'NEEDS_PROVIDER_SETUP' && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('open-setup-center', {
              detail: { initialCard: err.initialCard ?? 'provider' },
            }));
          }
          throw new Error(err?.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let accumulated = '';
        let tokenUsage: TokenUsage | null = null;
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
              const event: SSEEvent = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'text': {
                  accumulated += event.data;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'tool_use': {
                  try {
                    const toolData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolUses((prev) => {
                      if (prev.some((t) => t.id === toolData.id)) return prev;
                      return [...prev, { id: toolData.id, name: toolData.name, input: toolData.input }];
                    });
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    setStreamingToolOutput('');
                    setToolResults((prev) => [...prev, { tool_use_id: resultData.tool_use_id, content: resultData.content }]);
                  } catch { /* skip */ }
                  break;
                }
                case 'tool_output': {
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed._progress) {
                      setStatusText(`Running ${parsed.tool_name}... (${Math.round(parsed.elapsed_time_seconds)}s)`);
                      break;
                    }
                  } catch {
                    // Not JSON — raw stderr output
                  }
                  setStreamingToolOutput((prev) => {
                    const next = prev + (prev ? '\n' : '') + event.data;
                    return next.length > 5000 ? next.slice(-5000) : next;
                  });
                  break;
                }
                case 'status': {
                  try {
                    const statusData = JSON.parse(event.data);
                    if (statusData.session_id) {
                      setStatusText(`Connected (${statusData.model || 'claude'})`);
                      setTimeout(() => setStatusText(undefined), 2000);
                    } else if (statusData.notification) {
                      // Shared toast routing so code-driven notifications
                      // (e.g. RUNTIME_EFFORT_IGNORED) survive the next
                      // status-text update on both the first-message flow
                      // (this page) and the ongoing session flow
                      // (useSSEStream via stream-session-manager).
                      maybeShowStatusToast(statusData);
                      setStatusText(statusData.message || statusData.title || undefined);
                    } else {
                      setStatusText(event.data || undefined);
                    }
                  } catch {
                    setStatusText(event.data || undefined);
                  }
                  break;
                }
                case 'result': {
                  try {
                    const resultData = JSON.parse(event.data);
                    if (resultData.usage) tokenUsage = resultData.usage;
                    // Phase 1: seed terminal_reason into the snapshot the
                    // redirected ChatView will read so first-turn
                    // prompt_too_long / blocking_limit / max_turns /
                    // hook_stopped can still surface the chip + action
                    // buttons in the post-redirect view.
                    if (resultData.terminal_reason && session?.id) {
                      seedSnapshotPatch(session.id, {
                        terminalReason: resultData.terminal_reason as string,
                      });
                    }
                  } catch { /* skip */ }
                  setStatusText(undefined);
                  break;
                }
                case 'rate_limit': {
                  // Phase 2: subscription rate-limit telemetry. Seed the
                  // snapshot so RateLimitBanner renders after redirect.
                  try {
                    const info = JSON.parse(event.data);
                    if (session?.id) {
                      seedSnapshotPatch(session.id, { rateLimitInfo: info });
                    }
                  } catch { /* skip */ }
                  break;
                }
                case 'context_usage': {
                  // Phase 5 extension-point; no producer currently (see
                  // b65c6ac). Seed the snapshot for forward compatibility.
                  try {
                    const snap = JSON.parse(event.data);
                    if (session?.id) {
                      seedSnapshotPatch(session.id, { contextUsageSnapshot: snap });
                    }
                  } catch { /* skip */ }
                  break;
                }
                case 'thinking': {
                  // Opus 4.7 with display: 'summarized' streams reasoning
                  // as thinking deltas. Accumulate them into the same
                  // streamingThinkingContent surface that ChatView's
                  // MessageList already renders, so the first-turn UI
                  // shows the reasoning block as it streams in. Backend
                  // /api/chat/route.ts separately persists thinking as a
                  // content-block JSON on the assistant message, so the
                  // redirected ChatView gets a fully-formed message from
                  // DB — this branch is for the pre-redirect live view.
                  setStreamingThinkingContent((prev) => prev + event.data);
                  break;
                }
                case 'permission_request': {
                  try {
                    const permData: PermissionRequestEvent = JSON.parse(event.data);
                    setPendingPermission(permData);
                    setPermissionResolved(null);
                    setPendingApprovalSessionId(sessionId);
                  } catch {
                    // skip malformed permission_request data
                  }
                  break;
                }
                case 'error': {
                  // Try to parse structured error JSON from classifier
                  let errorDisplay: string;
                  try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.category && parsed.userMessage) {
                      errorDisplay = parsed.userMessage;
                      if (parsed.actionHint) errorDisplay += `\n\n**What to do:** ${parsed.actionHint}`;
                      if (parsed.details) errorDisplay += `\n\nDetails: ${parsed.details}`;
                      // Add diagnostic guidance for provider/auth related errors
                      const diagCategories = new Set([
                        'AUTH_REJECTED', 'AUTH_FORBIDDEN', 'AUTH_STYLE_MISMATCH',
                        'NO_CREDENTIALS', 'PROVIDER_NOT_APPLIED', 'MODEL_NOT_AVAILABLE',
                        'NETWORK_UNREACHABLE', 'ENDPOINT_NOT_FOUND', 'PROCESS_CRASH',
                        'CLI_NOT_FOUND', 'UNSUPPORTED_FEATURE',
                      ]);
                      if (diagCategories.has(parsed.category)) {
                        errorDisplay += '\n\n💡 [Run Provider Diagnostics](/settings/providers) to troubleshoot, or check the [Provider Setup Guide](https://www.codepilot.sh/docs/providers).';
                      }
                    } else {
                      errorDisplay = event.data;
                    }
                  } catch {
                    errorDisplay = event.data;
                  }
                  accumulated += '\n\n**Error:** ' + errorDisplay;
                  setStreamingContent(accumulated);
                  break;
                }
                case 'done':
                  break;
              }
            } catch {
              // skip
            }
          }
        }

        // Add the completed assistant message
        if (accumulated.trim()) {
          const assistantMessage: Message = {
            id: 'temp-assistant-' + Date.now(),
            session_id: session.id,
            role: 'assistant',
            content: accumulated.trim(),
            created_at: new Date().toISOString(),
            token_usage: tokenUsage ? JSON.stringify(tokenUsage) : null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        // Navigate to the session page after response is complete
        router.push(`/chat/${session.id}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // User stopped - navigate to session if we have one
          if (sessionId) {
            router.push(`/chat/${sessionId}`);
          }
        } else {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          setErrorBanner({ message: t('error.sessionCreateFailed'), description: errMsg });
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingThinkingContent('');
        setToolUses([]);
        setToolResults([]);
        setStreamingToolOutput('');
        setStatusText(undefined);
        setPendingPermission(null);
        setPermissionResolved(null);
        setPendingApprovalSessionId('');
        abortControllerRef.current = null;
      }
    },
    [isStreaming, router, workingDir, mode, currentModel, currentProviderId, permissionProfile, selectedEffort, thinkingMode, context1m, setPendingApprovalSessionId, t, hasProvider, modelReady, noCompatibleProvider, invalidDefault]
  );

  const handleCommand = useCallback((command: string) => {
    switch (command) {
      case '/help': {
        const helpMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Available Commands\n\n- **/help** - Show this help message\n- **/clear** - Clear conversation history\n- **/compact** - Compress conversation context\n- **/cost** - Show token usage statistics\n- **/doctor** - Check system health\n- **/init** - Initialize CLAUDE.md\n- **/review** - Start code review\n- **/terminal-setup** - Configure terminal\n\n**Tips:**\n- Type \`@\` to mention files\n- Use Shift+Enter for new line\n- Select a project folder to enable file operations`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, helpMessage]);
        break;
      }
      case '/clear':
        setMessages([]);
        break;
      case '/cost': {
        const costMessage: Message = {
          id: 'cmd-' + Date.now(),
          session_id: '',
          role: 'assistant',
          content: `## Token Usage\n\nToken usage tracking is available after sending messages. Check the token count displayed at the bottom of each assistant response.`,
          created_at: new Date().toISOString(),
          token_usage: null,
        };
        setMessages(prev => [...prev, costMessage]);
        break;
      }
      default:
        sendFirstMessage(command);
    }
  }, [sendFirstMessage]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length === 0 && !isStreaming && (!workingDir.trim() || !hasProvider) ? (
        <ChatEmptyState
          hasDirectory={!!workingDir.trim()}
          hasProvider={hasProvider}
          onSelectFolder={handleSelectFolder}
          recentProjects={recentProjects}
          onSelectProject={handleSelectProject}
          assistantConfigured={assistantConfigured}
          onOpenAssistant={() => {
            if (assistantConfigured) {
              // Navigate to the latest assistant session
              fetch(`/api/workspace/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'checkin' }),
              })
                .then(r => r.json())
                .then(data => router.push(`/chat/${data.session.id}`))
                .catch(() => {});
            } else if (assistantWorkspacePath) {
              setShowWizard(true);
            } else {
              router.push('/settings/assistant');
            }
          }}
        />
      ) : (
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          streamingThinkingContent={streamingThinkingContent}
          isStreaming={isStreaming}
          sessionId={createdSessionId}
          toolUses={toolUses}
          toolResults={toolResults}
          streamingToolOutput={streamingToolOutput}
          statusText={statusText}
        />
      )}
      {errorBanner && (
        <ErrorBanner
          message={errorBanner.message}
          description={errorBanner.description}
          className="mx-4 mb-2"
          onDismiss={() => setErrorBanner(null)}
          actions={[
            { label: t('error.retry'), onClick: () => setErrorBanner(null) },
          ]}
        />
      )}
      {/* Run Checkpoint — inline trust layer right above the composer.
          Round 1 wires Pinned-invalid / Runtime fallback / no-compatible-
          provider; later rounds add context-cost / permission-elevation /
          dangerous-tool. See `docs/exec-plans/active/chat-run-checkpoint.md`.
          The composer is gated separately via `disabled` so this banner
          is purely informative — but it's the only place we explain *why*
          send is blocked. */}
      <RunCheckpoint reasons={checkpointReasons} className="mb-2" onAction={handleCheckpointAction} />
      <PermissionPrompt
        pendingPermission={pendingPermission}
        permissionResolved={permissionResolved}
        onPermissionResponse={handlePermissionResponse}
        toolUses={toolUses}
      />
      <MessageInput
        onSend={sendFirstMessage}
        onCommand={handleCommand}
        onStop={stopStreaming}
        disabled={!modelReady || noCompatibleProvider || !!invalidDefault}
        isStreaming={isStreaming}
        modelName={currentModel}
        onModelChange={setCurrentModel}
        providerId={currentProviderId}
        // /chat is the new-conversation entry — no session yet, so the
        // picker follows the global agent_runtime via 'auto'. The
        // session-pinned `runtime_pin` only applies to /chat/[id]
        // (existing conversations).
        runtime={sessionRuntimeParam}
        onProviderModelChange={(pid, model) => {
          setCurrentProviderId(pid);
          setCurrentModel(model);
          localStorage.setItem('codepilot:last-provider-id', pid);
          localStorage.setItem('codepilot:last-model', model);
          // Codex P1 — manual picker override clears the
          // RunCheckpoint blocker. The picker is runtime-filtered (it
          // only surfaces models that resolve in the current
          // provider+runtime combo), so any (pid, model) the user
          // can pick from this dropdown is by construction reachable.
          // Without these resets, the new-chat page would stay
          // "固定默认模型不可用" / send-disabled even after the user
          // explicitly chose a working model — they'd have no way
          // out except to fix the global pinned default in Settings,
          // which is the wrong remedy when the user is just trying
          // to start a single conversation. The state these flags
          // gate (invalidDefault / noCompatibleProvider) describes
          // the GLOBAL default's reachability under the active
          // runtime; once the user has overridden it for this
          // conversation, that gate is no longer load-bearing.
          setInvalidDefault(null);
          setNoCompatibleProvider(false);
        }}
        workingDirectory={workingDir}
        effort={selectedEffort}
        onEffortChange={setSelectedEffort}
        initialValue={prefillText}
        onPendingContextTokensChange={setPendingContextTokens}
        blockingReasonIds={blockingReasonIds}
      />
      <ChatComposerActionBar
        left={
          <>
            <ModeIndicator mode={mode} onModeChange={setMode} disabled={isStreaming} />
            <RuntimeSelector
              runtimePin={runtimePin}
              effectiveRuntime={globalRuntime.agentRuntime === 'claude-code-sdk' ? 'claude_code' : 'codepilot_runtime'}
              onRuntimePinChange={(pin: ChatRuntime) => setRuntimePin(pin)}
              disabled={isStreaming}
            />
            <ChatPermissionSelector
              permissionProfile={permissionProfile}
              onPermissionChange={setPermissionProfile}
            />
          </>
        }
        right={
          <RunCockpit
            providerId={currentProviderId}
            messages={[]}
            modelName={currentModel}
            permissionProfile={permissionProfile}
            pendingContextTokens={pendingContextTokens}
            sessionRuntimePin={runtimePin}
          />
        }
      />
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderPickerSelect}
      />
      {showWizard && assistantWorkspacePath && (
        <OnboardingWizard
          workspacePath={assistantWorkspacePath}
          onComplete={(session) => {
            setShowWizard(false);
            setAssistantConfigured(true);
            router.push(`/chat/${session.id}`);
          }}
        />
      )}
    </div>
  );
}
