# AGENTS.md

CodePilot - Codex's desktop GUI client, built with Electron and Next.js.

This is Codex's native entry file. Shared cross-agent rules live in `~/.agents/global-rules.md`.

## Required Rule Load

Before answering or doing work in this repository, Codex must read and follow:

1. `~/.agents/global-rules.md`
2. `.agents/codex-profile.md`
3. This file
4. Any closer nested `AGENTS.md` or `AGENTS.override.md`

If these conflict, apply higher-priority system, developer, and user instructions first; then apply the closest runtime-specific rule. `AGENTS.md` and `.agents/codex-profile.md` control Codex role boundaries. `~/.agents/global-rules.md` controls shared user-level workflow, safety, and verification rules.

## Codex Role Boundary

Codex is responsible for planning, review, testing, reproduction analysis, execution plans, and documentation.

Codex may:

- Review code and logs.
- Locate risks and root causes.
- Design reproduction paths.
- Run tests and summarize failures.
- Generate repair plans and diff suggestions.
- Modify documentation, execution plans, research records, handover material, and test cases.

Codex must not modify product code, runtime code, build scripts, database schema, style implementation, or business logic implementation files unless the user explicitly changes the collaboration mode.

When code repair is needed, Codex should provide the root cause, risk assessment, validation plan, and suggested patch for Claude Code to implement.

## Project References

- [ARCHITECTURE.md](ARCHITECTURE.md) - architecture, directory structure, data flow, and feature touch points.
- [docs/design.md](docs/design.md) - UI design patterns.
- [docs/exec-plans/README.md](docs/exec-plans/README.md) - execution-plan process and active index.
- `.agents/codepilot-agent-bootstrap.md` - desired product behavior for future automatic multi-agent rule loading.

## Project Notes

<!-- cs-note managed: use cs-note to append short project facts under these sections -->

### Build And Compile

### Running Locally

- Before starting Electron debug, clear processes occupying port `3000`; avoid Electron/Next dev connecting to stale processes.

### Testing

### Command And Script Pitfalls

### Paths And Directories

### Environment Variables And Credentials

### Other

- Before developing new skills or features, review `docs/handover/project-architecture-reuse-map.html` and extend the existing Provider, model, Runtime, request-building, connection-test, MCP/tool, context, and Electron architecture where possible.
