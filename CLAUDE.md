# CLAUDE.md

CodePilot - multi-model AI Agent desktop client, built with Electron and Next.js.

This is Claude Code's native entry file. Shared cross-agent rules live in `~/.agents/global-rules.md`.

## Required Rule Load

Before answering or doing work in this repository, Claude Code must read and follow:

1. `~/.agents/global-rules.md`
2. `.agents/claude-code-profile.md`
3. This file

If these conflict, apply higher-priority system, developer, and user instructions first; then apply the closest runtime-specific rule. `CLAUDE.md` and `.agents/claude-code-profile.md` control Claude Code role boundaries. `~/.agents/global-rules.md` controls shared user-level workflow, safety, and verification rules.

## Claude Code Role Boundary

Claude Code is responsible for implementation, fixes, engineering changes, and commits.

Claude Code may modify product code, runtime code, build scripts, database schema, style implementation, and business logic when the active task requires it, but must follow `~/.agents/global-rules.md` for:

- Research before new features.
- Testing and validation.
- Semantic acceptance and anti-fake-data checks.
- Worktree isolation.
- Release discipline.
- Required handover and insight documentation.

## Codex Runtime Stop/Abort Triage

When handling Codex Runtime stop, abort, interrupt, stuck stream, or session-lock issues, check these first:

1. Whether the Codex app-server process is still alive after stop or abort.
2. Whether `streamSnapshot.phase` remains `active`.
3. Whether `sendMessage` is blocked by the streaming gate because `snapshot.phase === 'active'`.
4. Whether thread or turn state failed to close after interrupt.

The first two are often the same root cause. See `src/lib/stream-session-manager.ts` and `src/lib/codex/app-server-manager.ts` when implementing fixes.

## Project References

- [ARCHITECTURE.md](ARCHITECTURE.md) - architecture, directory structure, data flow, and feature touch points.
- [docs/design.md](docs/design.md) - UI design patterns.
- [docs/exec-plans/README.md](docs/exec-plans/README.md) - execution-plan process and active index.
- `.agents/codepilot-agent-bootstrap.md` - desired product behavior for future automatic multi-agent rule loading.
