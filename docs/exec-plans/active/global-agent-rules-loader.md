# Global Agent Rules Loader

> 创建时间：2026-06-16
> 最后更新：2026-06-16

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 用户级规则文件分层与入口改造 | ✅ 已完成 | 新增用户级 `~/.agents/global-rules.md`；CodePilot runtime profile / bootstrap 放入项目内 `.agents/`；`AGENTS.md` / `CLAUDE.md` 作为入口文件 |
| Phase 1 | CodePilot 会话启动器规则加载设计 | 📋 待 Claude Code 接手 | 设计 rule discovery、source breadcrumb、长度/缺失 warning、runtime-specific merge |
| Phase 2 | 后端/Runtime prompt bundle 接入 | 📋 待 Claude Code 接手 | 在新对话启动时注入 global + runtime profile + native entry，不显示假 loaded 状态 |
| Phase 3 | UI 可见性与语义验收 | 📋 待 Claude Code 接手 | 显示 loaded/skipped/truncated rule sources，所有字段有真实 source breadcrumb |
| Phase 4 | 测试与 smoke | 📋 待 Claude Code 接手 | 覆盖无规则、有规则、Codex、Claude Code、超长、缺失、worktree/root 解析场景 |

## 决策日志

- 2026-06-16: 不把 `CLAUDE.md` 作为跨 Agent 全局规则源；改用 provider-neutral 的 `~/.agents/global-rules.md`，再由 `AGENTS.md`、`CLAUDE.md` 和 CodePilot 会话启动器分别引用。原因：`CLAUDE.md` 是 Claude Code 生态入口，混有 provider-specific 角色和排查说明，直接作为所有 Agent 规则会造成语义污染。
- 2026-06-16: 全局规则文件放在用户级 `~/.agents`，不是项目内 `.agents`。原因：目标是所有 Agent 第一次打开对话时自动加载同一套用户级规则，而项目内 `.agents/` 已用于本地技能资产。
- 2026-06-16: CodePilot 专属 runtime profile 和 bootstrap 从用户级 `~/.agents` 移到项目内 `.agents/`。原因：用户级共享目录只保存跨项目规则；项目角色边界和产品加载设计属于 CodePilot 项目规则。
- 2026-06-16: 规则加载 UI 必须展示 source breadcrumb。原因：用户看到"已加载规则"时必须能追到真实文件，不能把缺失、跳过、截断伪装成成功加载。

## 详细设计

### 用户会看到什么变化

Phase 1-4 完成后，用户在 CodePilot 创建新 Agent 对话时，可以看到当前会话实际加载了哪些规则文件，以及哪些规则被跳过或截断。不同 runtime 会共享用户级 `~/.agents/global-rules.md`，并叠加 CodePilot 项目内 profile：

- Codex: `~/.agents/global-rules.md` + `.agents/codex-profile.md` + `AGENTS.md`
- Claude Code: `~/.agents/global-rules.md` + `.agents/claude-code-profile.md` + `CLAUDE.md`
- Future runtime: `~/.agents/global-rules.md` + `.agents/{runtime}-profile.md` when available

### 本阶段明确不做什么

- 不把 `CLAUDE.md` 当成 provider-neutral 全局规则。
- 不在规则缺失时显示假 loaded。
- 不静默截断规则文本。
- 不让 runtime 自己重新解释共享规则语义。

### Discovery Contract

Rule discovery should resolve workspace root first, then collect:

| Source | Required | Breadcrumb |
|--------|----------|------------|
| `~/.agents/global-rules.md` | yes when present | `user-rules-fs:~/.agents/global-rules.md` |
| `.agents/codex-profile.md` | Codex only | `workspace-rules-fs:.agents/codex-profile.md` |
| `AGENTS.md` | Codex only | `workspace-rules-fs:AGENTS.md` |
| `.agents/claude-code-profile.md` | Claude Code only | `workspace-rules-fs:.agents/claude-code-profile.md` |
| `CLAUDE.md` | Claude Code only | `workspace-rules-fs:CLAUDE.md` |
| `.agents/{runtime}-profile.md` | future runtimes | `workspace-rules-fs:.agents/{runtime}-profile.md` |

The prompt bundle should preserve source order and include metadata for UI/debugging.

### Semantic Acceptance

Any UI claiming that rules are loaded must answer:

1. Which files were actually read?
2. Which files were expected but missing?
3. Which files were skipped because the runtime did not apply?
4. Were any files truncated because of size limits?
5. What source breadcrumb backs each visible status?

When source data is missing, show `unsupported` or a clear unavailable state instead of fake zeroes or success badges.

### Test Plan

Claude Code should add tests for:

- No `~/.agents/global-rules.md`: UI does not show global rules as loaded.
- Existing `~/.agents/global-rules.md`: first-turn prompt includes it and metadata includes `user-rules-fs:~/.agents/global-rules.md`.
- Codex runtime: global + codex profile + `AGENTS.md` are loaded.
- Claude Code runtime: global + Claude profile + `CLAUDE.md` are loaded.
- Missing provider profile: global still loads, provider profile appears as missing or skipped with honest status.
- Oversized rule file: prompt bundle truncates or rejects according to design and UI shows the warning.
- Worktree/subdirectory root resolution: correct workspace rules are loaded, not parent-project stale rules.

### Verification

Before implementation is accepted:

- Run targeted unit tests for rule discovery and prompt bundle construction.
- Run `npm run test`.
- Run smoke for Codex and Claude Code conversation creation.
- Record real smoke evidence in this plan's Smoke Ledger.

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 跑了真实 smoke 后必须在这里登记一行：Runtime / Provider / Model / 凭据形态 / 场景 / 结果 / 证据。不要把这类信息只留在聊天里——下次切回这个 Phase 时翻不到。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | codex_runtime | OpenRouter | claude-haiku-4.5 | API key | two-turn chat with global rules loaded | ✅ | session id / rule breadcrumb |
