# Research / 调研文档

技术方案调研、可行性分析、POC 验证记录。

**AI 须知：修改或新增文件后更新下方索引；检索本目录前先读此文件。**

## 索引

| 文件 | 主题 |
|------|------|
| harness-and-ux-refactor.md | **[事实输入归档]** 排期已收束至 `exec-plans/active/agent-trust-ownership-refactor.md`;本文仅保留事实速览(Harness 各层、记忆 V3、Hermes 进度)+ Google design.md 调研 + 讨论日志,作为新计划 Phase 0-4 输入 |
| chat-latency-investigation-2026-03-20.md | 聊天响应变慢问题排查报告（用户设置 / MCP / resume 链路） |
| chat-sdk-integration-feasibility.md | Vercel Chat SDK 集成可行性调研 |
| context-storage-migration-plan.md | 上下文共享与存储迁移设计（详细方案；执行跟踪见 `docs/exec-plans/active/context-storage-migration.md`） |
| mobile-remote-control-overall-plan.md | 移动端远程控制整体方案（Host / Controller / Lease / 多设备控制） |
| weixin-openclaw-plugin-review-2026-03-22.md | OpenClaw 微信插件拆包与 CodePilot 逆向集成可行性调研 |
| chat-latency-remediation-review-2026-03-22.md | Chat Latency 修复 Code Review（effort 收敛、MCP 持久化开关、resume 首 token 优化） |
| mcp-tooling-agent-sdk-review-2026-03-10.md | MCP 工具 + Agent SDK 集成调研 |
| skills-agent-sdk-review-2026-03-10.md | Skills + Agent SDK 集成调研 |
| issue-analysis-2026-04-02.md | GitHub Issues #356-#417 分类分析：第三方 Provider CLI 崩溃、配置持久化丢失、Windows 兼容性 |
| packaged-preview-runtime-diagnosis-2026-05-31.md | **预览包运行时启动诊断**：三症状（Codex「应用服务启动失败」/「准备运行环境」/Settings 卡几十秒）统一根因 = Codex app-server 失败时 CodePilot 等满 30s RPC 超时。**2026-06-01 POC 实测修正**：xhigh 配置不是真因——失败的是旧 `/opt/homebrew/bin/codex`（已卸载），当前 `.app 0.133.0` 接受 xhigh，端到端实测可出 6 模型。修复转向 P0 快速失败（init 期退出立即 reject）+ P1 clamp 外发 effort；否决 spawn `-c` 覆盖。关联 preview-build-readiness Phase 1 |
| tool-call-thinking-display.md | 工具调用思考过程展示实现方案（数据链路、组件改动、设计决策） |
| tool-call-ux-competitive-analysis.md | 工具调用 UX 竞品调研：Claude Code / CraftAgent / Opencode / Codex 的展示与交互设计对比 |
| agent-loop-self-built.md | 脱离 Claude Code：自建 Agent Loop 替代 SDK — Vercel AI SDK streamText 方案 |
| mcp-system-decoupling.md | 脱离 Claude Code：MCP 系统独立化 — 连接管理 + 内置 Server 迁移 |
| cli-tools-implementation.md | 脱离 Claude Code：8 个核心工具自建方案 — Schema/实现/复杂度评估 |
| skills-system-independent.md | 脱离 Claude Code：Skills 系统独立化 — 解析/发现/执行 |
| permission-system-decoupling.md | 脱离 Claude Code：权限系统独立化 — 三级模式 + 规则引擎 + bash 验证 |
| session-management-and-context-compaction.md | 脱离 Claude Code：会话管理 + 三层上下文压缩方案 |
| sub-agent-system.md | 脱离 Claude Code：子 Agent 系统 — AgentTool + Runner 设计 |
| pi-framework-analysis.md | Pi AI 框架调研 — 多 Provider 抽象（17+ Provider + OAuth）、Agent Loop、Extension 系统 |
| hermes-agent-analysis.md | Hermes Agent 分析 — 三段式对比（外部事实 / 本仓库 file:line / 推断）：并行安全调度、辅助 provider + sdkProxyOnly fallback、渐进式子目录 hint、session 搜索等借鉴路线图 |
| provider-registry-comparison.md | Provider 注册表对比 — Hermes 三层合并（models.dev + overlay + user）vs CodePilot 硬编码 VENDOR_PRESETS，改进路线图 |
| provider-model-discovery.md | Provider 模型发现 spike — 三类划分（可 API 获取 / 实验性 / 不可获取需手动）、`src/lib/model-discovery.ts` + `POST /api/providers/[id]/discover-models` 只读路由、安全约束（无写入 / 无回显 key / 必带 timeout） |
| feishu-cli-one-click-bot.md | 飞书 CLI 一键创建机器人逆向调研 — App Registration Device Flow API、PersonalAgent 模板 POC 已通过（全链路验证：凭据→WSClient→消息接收）、集成方案设计 |
| markdown-editor-tiptap-evaluation.md | Markdown 渲染/编辑体系调研 — Tiptap 不推荐作主栈（ProseMirror 无虚拟化、往返有损）；长文档卡死根因指向 `MessageResponse` 整串重渲；编辑器推荐 CodeMirror 6 |
| artifact-preview-ai-elements.md | Artifact 预览组件调研 — 确认 Vercel AI Elements 身份（shadcn registry），现有 `artifact.tsx` 仅 UI 壳未接入；建议加 `web-preview`/`jsx-preview` 并扩 `PreviewPanel` 支持 inline 内容与 JSX |
| craft-agents-docs-system-review.md | Craft Agents 文档体系对标调研 — craft 外部入口文档（Issue 模板 / CONTRIBUTING / 嵌入式架构树）更完整；CodePilot 内部研发文档链（exec-plans / research / handover-insights 互链）显著更强；P0 借鉴清单：YAML Issue 模板 + PR 模板 + CONTRIBUTING + SECURITY |
| craft-agents-markdown-internals.md | Craft Agents 内部 Markdown 实现调研 — 渲染走 react-markdown + unified + Shiki LRU；Tiptap 仅用于编辑器；**代码块 language 拦截 = 10 个 MarkdownXxxBlock 轻量 Artifact**（Mermaid/Diff/JSON/Datatable/HTML/PDF/Image）；`id + children` 双键 memo 可修复 CodePilot 长文档重渲；修订了 Tiptap 评估与 AI Elements Artifact 路径 |
| review-packet-opus-4-7-and-sdk-0-2-111.md | **Codex 审查包**：Opus 4.7 升级 + Agent SDK 0.2.111 采纳本轮迭代的范围、commit 分组、关键架构决策、已知 out-of-scope、测试状态、希望重点审的 7 个点 |
| codex-sdk-app-server-coverage.md | Codex 集成路径调研 — app-server (当前实现) vs `@openai/codex-sdk` 能力对照；结论：本轮不引入 SDK，原生 plugins/skills 在 CodePilot UI 不渲染是双层缺口（事件映射 + UI 分支）非 SDK 单独能填；Settings 用户层 copy 已诚实标注 |
| phase-6-context-breakdown-data-audit.md | Phase 6 上下文用量可视化 Phase 0 数据审计 — 10 类 `ContextBreakdownKind` 的源码出口映射（system_prompt / tools / rules / skills / mcp / memory / files_attachments / conversation / pending_next_turn / cache_or_previous）；`useContextUsage` / `walkContextUsage` / `context-estimator` / `harness-bundle` 接口快照；StreamSession guardrail 合规检查 |
| codex-mcp-injection-poc/ | **[Phase 8 / Phase 0 POC — 已 live 验证]** Codex 原生 per-thread `config.mcp_servers` 注入在真实 `0.133.0` app-server（隔离 CODEX_HOME）跑通：注入被接受、stdio fixture 即时启动、`mcpServer/tool/call` 命中、错误/elicitation 往返/broken-server 失败均被暴露；唯一 auth-gated = 模型自主调用。纠正文档两处假设（per-thread server 不进 `mcpServerStatus/list`，状态走 `startupStatus/updated` 通知） |
