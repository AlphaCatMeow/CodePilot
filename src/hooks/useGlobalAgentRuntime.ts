"use client";

import { useEffect, useState } from "react";

/**
 * Lightweight global-agent-runtime hook.
 *
 * Returns just `agent_runtime` from `/api/settings/app` — a single
 * fetch, no fan-out, no transitive imports of `runtime/effective` /
 * provider catalog / `useClaudeStatus`. Use this for surfaces that
 * only need to display the current global runtime label (e.g.,
 * RuntimeSelector's fallback when the session has no explicit pin),
 * NOT for full health snapshots.
 *
 * For Settings → Overview / Health / Runtime full snapshot, keep
 * using `useOverviewData` — that hook fans out to 6+ endpoints and
 * pulls in the runtime resolver, which is exactly what we want OUT
 * of the chat first-paint compile graph (see chat-static-graph.test.ts).
 *
 * Refresh strategy: same `provider-changed` event the heavy
 * `useOverviewData` listens for, so a runtime change made on the
 * Settings page propagates back to chat surfaces consistently.
 */
export interface GlobalAgentRuntimeState {
  /** Stored `agent_runtime` setting. Defaults to `'claude-code-sdk'` —
   *  matching the same default the resolver uses when the row is
   *  missing — so the first paint never renders an empty label. */
  agentRuntime: "claude-code-sdk" | "native";
  /** True until the first fetch resolves. Callers can choose to
   *  render the default label optimistically or wait. */
  loading: boolean;
}

export function useGlobalAgentRuntime(): GlobalAgentRuntimeState {
  const [state, setState] = useState<GlobalAgentRuntimeState>({
    agentRuntime: "claude-code-sdk",
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/settings/app")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          const stored = data?.settings?.agent_runtime;
          // Only `'native'` opts out; everything else (including
          // legacy `'auto'`) coerces to `'claude-code-sdk'` so the
          // selector label matches what `runtime/legacy.ts` would
          // produce. This is a one-line coercion — we deliberately
          // do NOT import `runtime/legacy` here to keep the hook's
          // graph empty.
          const agentRuntime: "claude-code-sdk" | "native" =
            stored === "native" ? "native" : "claude-code-sdk";
          setState({ agentRuntime, loading: false });
        })
        .catch(() => {
          if (!cancelled) {
            setState((prev) => ({ ...prev, loading: false }));
          }
        });
    };

    load();
    if (typeof window !== "undefined") {
      window.addEventListener("provider-changed", load);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("provider-changed", load);
      }
    };
  }, []);

  return state;
}
