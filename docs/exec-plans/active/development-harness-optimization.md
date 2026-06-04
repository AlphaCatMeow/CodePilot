# Development Harness Optimization / 开发流程 Harness 优化

> 创建：2026-05-19（Codex 初稿）
> 重写：2026-05-19（ClaudeCode v2 — 按用户"可审核"约束重组结构；事实层面增 3 项 Codex 初稿漏说的已有资产；方向上把 Skill 化暂缓、改主推自动检查脚本 + 测试矩阵补洞）
> 状态：📋 讨论稿；先与用户对齐 Step 1-3 再决定是否进入 Step 4-6
> 触发：用户问"为什么 Phase 5 接入 Codex 花了 3 天，下次接 Hermes / Gemini / OpenClaw 还会重复这种边跑边修吗"
> 参考材料：
> - Anthropic 大型代码库 Claude Code 最佳实践（用户提供本地文档；原文：<https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start>）
> - OpenAI Codex use cases：<https://developers.openai.com/codex/use-cases>（仅作为任务类别参考：review / tests / docs upkeep / web/native verification，不作为执行方案依据；本计划的具体优先级仍以 Anthropic 大代码库文档 + 本仓库 Phase 5 事实审计为准）

## 用户审核护栏（本计划的元规则）

用户已明确说明：

> "我可以判断产品方向和用户体验，但是很少理解技术细节，一旦你们给的内容过细，我就无法审核，导致方向偏离我无法发现。"

后续 Codex / ClaudeCode 推动这份计划时，**每一份 Phase / Step 必须满足**：

1. **每个 Step 开头必须先答三件事**——用日常语言：
   - 用户能看到什么变化（visible result）
   - 不做什么（explicit scope cut）
   - 怎么验收 / 用户怎么自己判断成功（verification the user can perform）
2. **技术实现细节集中在该 Step 的"实现路径"小节**，并明确标注 `> 此部分用户不需审核，仅 Codex / ClaudeCode 对齐用`。脚本名 / 函数名 / 文件路径 / 测试名只能出现在这里，不能出现在目标里
3. **不要把脚本名作为目标**——"加 `lint:docs-drift` 脚本"不是目标，"提交时 active 文档说在跑但代码已完成会自动报错"才是目标
4. **决策变化（删 Step / 砍范围 / 调整顺序）必须先用用户能看到的层面解释**——不能只用"contract test 矩阵补洞效率更高"这种用户无法判断的理由

## 用户视角 — 为什么发起这次讨论

四件用户能感知到的事，三天内重复发生：

1. **真实凭据 smoke 反复打补丁**——"我让你跑通的，第二天换个模型 / 凭据形态又炸；改完又通了；过一会还报错"，共 4 轮
2. **提交一次卡 30 分钟**——用户看着等
3. **Settings 状态显示让人困惑**——"一直转圈说'检测中'"、"按钮文字'待启动'像还没准备好"，共 2 次反复
4. **范围边界事故**——"我让你 Phase 5 收尾，你又回去改代码"

这些都不是单点功能 bug，是"流程没有按用户预期收敛"。Codex 触发本计划的核心问题：以后再接 Hermes / Gemini / OpenClaw 时，是否还会重复这种边跑边修。

## 用户能验收的目标

升级完成后，用户应该能在以下场景**直接观察到流程变得稳定**：

| 用户场景 | 升级前的现象（已观察到） | 升级后用户能看到 |
|---|---|---|
| 接入第 N 个 Agent Runtime | 反复"再 smoke 一次 / 再修一轮" | Agent 在动手前主动展示"我先读了哪几份必读 + 跑了哪条契约测试" |
| 改 docs/exec-plans 文档 | 用户人工 grep 才发现"active 说在跑、代码已完成"漂移 | 提交时自动报错，明确指出哪一行漂移 |
| 跑真实 smoke 后做下一步 | 结果散落聊天，下次问"上次跑过没？" | 每个 Phase 计划里有固定 Smoke Ledger 表 |
| 提交代码 | 偶尔卡 30 分钟 | 提交时间稳定在 30 秒内 |
| Agent 改高风险代码 | 用户反复提醒"你看了 XX 文档没" | Agent 自动引用"我读了 guardrails/Runtime.md 第几条不变量" |

**用户无法直接判断、需要 Codex / ClaudeCode 互相验证的层级**：
- 测试矩阵覆盖度
- SDK 兼容层分流是否正确
- 脚本检查的误报率

→ 这些必须由"是否还在重复出同类问题"间接验证，不直接占用用户审核精力。

## 为什么 Phase 5 花了 3 天 — 耗时归因

Phase 5 收口前的最后 10 个 commit，按用户能感知的类别分桶：

| 类别 | 提交次数 | 用户能感知的现象 | 真正的根因（用户不需审） |
|---|---|---|---|
| 真实凭据 smoke 反复发现新坑 | 4 | 切换 provider / 凭据形态 / 模型就报错 | capability × protocol × credential 矩阵契约测试有洞 |
| 工程隔离 | 1 | 提交卡 30 分钟 | pre-commit hook 与 dev server 抢同一份 SQLite 锁 |
| UI 文案 / 状态机 | 2 | Settings 永远转圈、"待启动"像没准备好 | 用户语言反馈循环不在固定流程里 |
| Docs closeout | 2 | 用户要明确说"归档 Phase 5" | active → completed 移动不是自动触发 |
| 收口本身 | 1 | 用户最终授权才结束 | 边界一直靠用户兜底 |

**结论**：耗时主因（4/10）是契约测试矩阵的洞，第二是工程隔离（1/10）+ docs closeout 自动化缺失（2/10）。**单纯加 Skill / 加 checklist 对这三类都不直接生效**——必须用测试矩阵 + 自动检查脚本 + 流程模板分别打。

> 实现路径（用户不需审核）：上述 10 个 commit 是 b7f6f23 / 752e0bd / 4e6add2 / 4b04f88（4 个真实 smoke 反复）、3458d80（hook 隔离）、db9980c / 76599fc（UI 状态机 + 文案）、c2e631d / 4296d2f（docs closeout）、收口边界。

## 当前事实审计

### 已经存在的流程资产（v2 增 3 项 Codex 初稿漏说的）

| 资产 | 已经在做什么 | 用户能感知 |
|---|---|---|
| `AGENTS.md` 第 102 行 Signal→Triage→Fix→Verify→Guardrail 闭环 | 修复闭环规则 | 已沉淀进 tech-debt-tracker，但执行靠 Agent 记忆 |
| `.husky/pre-commit`（含测试隔离开关）| 自动跑 typecheck + 单测 | 提交不再卡 30 分钟 |
| `docs/exec-plans/README.md` + 总控板 | Phase 状态 + 接管清单 | 用户从一个入口看到全部主线状态 |
| **`docs/guardrails/` 已有 4 份模块契约**（v2 新增 — Codex 初稿漏说） | Runtime / ProviderManagement / ModelDiscovery / ComposerModelSelection 各模块的"不变量 + 关键文件 + 改动检查表 + 常见坑 + 测试覆盖 + 决策日志" | Agent 改对应模块前必须先读，这是"Module Entry Map"的早期形态 |
| **`package.json` 的 `lint:colors` 脚本**（v2 新增 — Codex 初稿漏说） | 颜色合规自动检查 | 改 UI 颜色不合规时自动报错；这是"docs drift 检查"的同形态先例 |
| **`docs/exec-plans/tech-debt-tracker.md` 17 活跃 + 2 已解决**（v2 新增 — Codex 初稿漏说） | review finding 结构化沉淀 | 用户能看到"已知没修的 17 条" |
| Phase 5e 后的契约测试基线 `harness-capability-contract.test.ts` | live = zero unsupported exposures | 接 Runtime 前必须先过契约测试 |

### 当前主要缺口

| 缺口 | 用户能看到的现象 | 真正的根因（用户不需审） |
|---|---|---|
| 真实凭据 smoke 反复发现新问题 | "切换模型 / 凭据就报错" | capability × protocol × credential 矩阵契约测试有洞 |
| docs drift 靠人工 grep | "active 文档说在跑，代码已完成" | 没脚本化检查 |
| Smoke 结果散落聊天 | "上次跑过没？跑了哪个 provider？" | Smoke Ledger 没固定字段 |
| Module entry 已有但只覆盖 4 类 | "Agent 改 i18n 又忘了同步"、"改 DB schema 漏了备份"、"权限边界改完没补回归" | guardrails/ 索引还没扩到 i18n / DB / Permission / Stream / MCP / Onboarding / IPC / Release 八类高风险入口 |
| 任务开始时 Agent 不主动展示"必读" | 用户要主动问 / 提醒 | 没有 pre-task 自动引用机制 |

## 方向比较（替代 Codex 初稿的 "Anthropic 启发 + OpenAI use cases" 两节）

| 方向 | 用户能感知到的变化 | 主要风险 | v2 推荐 |
|---|---|---|---|
| **A. Skill 化（Codex 初稿主推）** | Agent 触发同类任务时引用同一份 Skill；但 Agent 仍可能跳过 / 忘记 | Skill 本质是提示词，跟现有 AGENTS.md + handover/ 重叠。能解决"Agent 忘规则"但**不解决用户实际看到的三件事：切换模型就报错 / 提交卡死 / 文档漂移** | 暂缓 |
| **B. 自动检查脚本（v2 主推）** | 提交时直接报错，用户不需要人工记得检查；和现有"颜色合规检查"同形态 | 写脚本要 1-2 天；不能替代测试矩阵 | ✅ 优先 |
| **C. 测试矩阵补洞（v2 主推）** | 接 Hermes / Gemini 时第一次跑测试就挡掉同类问题 | 用户无法直接审核测试质量；需要 Codex / ClaudeCode 配合 | ✅ 优先 |

→ **B + C 一起做，A 暂缓**。如果半年后回看"Skill 没人读、测试洞还在出"，再考虑 A。

## 建议的"第一刀"（替代 Codex 初稿的 Phase 0-5）

每一步都用"用户能看到什么 / 不做什么 / 怎么验收"开头。

### Step 1 — 写一份 Phase 5 耗时归因表

- **用户能看到什么**：本计划"耗时归因"那一节的 5 行表，每行都能用日常语言复述发生了什么。作为后续投资优先级的事实依据
- **不做什么**：不改任何代码，不动业务逻辑
- **怎么验收**：用户读这张表，要求 ClaudeCode 用日常语言复述其中任意一行的发生过程 → 复述对得上 commit 实际内容

> 实现路径（用户不需审核）：直接读取本 session 上下文里的 10 个 commit hash 和归因结论；产出 markdown 表格已写入"为什么 Phase 5 花了 3 天 — 耗时归因"那一节。等用户认可后冻结。

### Step 2 — docs drift 自动检查

- **用户能看到什么**：提交涉及 `docs/exec-plans/**` 时，如果有"active 说在跑、代码已归档"或"completed 内部链接还指向 ../active/"类漂移，提交自动失败、显示具体哪一行
- **不做什么**：不改任何业务代码；不影响 src/ 的提交速度（脚本只在改文档时触发）
- **怎么验收**：用户手动制造一次漂移（在 README active 表里写一个不存在的 phase 文件），尝试 commit → 应该被脚本挡掉

> 实现路径（用户不需审核）：`npm run lint:docs-drift` 脚本 + lint-staged path glob 只在改 `docs/exec-plans/**` 时触发；脚本读 README 的 active 表 + 校验每行链接的文件是否存在 + 校验 `completed/*.md` 不含 `../active/` 内链。

### Step 3 — pre-commit 配置自检

- **用户能看到什么**：保证 pre-commit hook 永远包含"测试隔离"开关；未来如果有人改 hook 把开关弄丢了（就像 Phase 5b 那次卡 30 分钟的事），下次提交直接失败、提示加回来
- **不做什么**：不影响正常 commit 速度（脚本只检查 hook 文件本身，毫秒级）
- **怎么验收**：临时把开关从 hook 里删掉，尝试 commit → 应该被脚本挡掉

> 实现路径（用户不需审核）：`npm run lint:hooks` 脚本 grep `.husky/pre-commit` 必须含 `CODEX_DISABLED=1`，pre-commit 自身先跑这个 lint。

### Step 4 — 把"必读"扩到 guardrails/ 八类高风险入口

- **用户能看到什么**：Agent 改 i18n / DB schema / Permission / Stream / MCP / Onboarding / IPC / Release 这八类代码前，自动引用对应 guardrails 文档并说"我读了第几条不变量"。用户可以随机抽查任意一份让 Agent 复述
- **不做什么**：不一次性把 8 份文档全写满——先建空 stub（只有标题 + 待填充提示），每次真实改动时由实施 Agent 填一节，避免"为写文档而写文档"
- **怎么验收**：用户随便挑一份 stub，要求 Agent 先读 → Agent 必须能引用文档里某条不变量；如果引用不出来，说明这份 stub 还没填充到位

> 实现路径（用户不需审核）：扩 `docs/guardrails/README.md` 索引到 8 类；建 8 个 stub 文件（i18n.md / DatabaseSchema.md / PermissionBoundary.md / StreamSession.md / MCP.md / Onboarding.md / ElectronMain.md / Release.md）；每个 stub 用同一七节模板（词汇表 / 不变量 / 关键文件 / 改动检查表 / 常见坑 / 测试覆盖 / 决策日志）。

### Step 5 — Smoke Ledger 模板化

- **用户能看到什么**：未来每个 Phase 计划里都有固定一张 Smoke Ledger 表，记录哪个 provider / 模型 / 凭据形态在哪一天跑过、结果如何。这样切回某个 Phase 时不用翻聊天回忆
- **不做什么**：不追溯过往已完成 phase 的 ledger，只对未来生效
- **怎么验收**：下一个新建的 Phase 计划必须自动带这段；如果新建的 Phase 没带，Step 2 的 docs-drift 脚本会挡

> 实现路径（用户不需审核）：在 `docs/exec-plans/README.md` 的执行计划模板加 `## Smoke Ledger` 必填段；Step 2 的 docs-drift lint 把"新建 active phase 必须含 Smoke Ledger 段"也并入校验。

### Step 6（最后再决定是否做）— 测试矩阵补洞

- **用户能看到什么**：**用户无法直接审核**（这里 v2 必须如实告诉用户）。但能从"接下一个 Runtime / Provider 时是否还在重复出 OpenRouter Anthropic-skin / OAuth refresh 那类坑"间接判断
- **不做什么**：不为补洞而搭复杂测试基础设施；只补已知踩过的 4 个桶（OpenRouter Anthropic-skin / OAuth refresh / 长尾 retry / 历史 DB 行 canonicalization）
- **怎么验收**：等下次接 Hermes / Gemini 时回看。如果再没出现"切换模型就炸"，这一刀就有效

> 实现路径（用户不需审核）：在 `harness-capability-contract.test.ts` 一类的契约测试里，把 capability × protocol × credential 矩阵的已知洞补成断言；不新建测试框架，只扩已有契约测试。

## 已删除 / 不做的项（替代 Codex 初稿对应内容）

| Codex 初稿提议 | v2 决定 | 用户视角理由 |
|---|---|---|
| Phase 2 — Internal Development Skills（5 个 Skill）| 全部暂缓 | 用户能看到的三件事（切换模型报错 / 提交卡死 / 文档漂移）不是"Agent 忘了规则"导致的，Skill 解决不了 |
| Phase 5 — Collaboration Protocol（Codex / ClaudeCode / Explorer 分工固化）| 删除 | 用户已经在用授权式协作（"明确允许做 X、不允许做 Y"）。把角色写死会让该弹性化的地方僵化 |
| Phase 1 表里"必读"指向 `completed/phase-5-codex-runtime.md` | 改指向 `docs/handover/` + `docs/guardrails/` | 归档计划是历史快照不再维护；必读应指持续维护的文档 |
| "Anthropic 启发" + "OpenAI Codex use cases" 两节 | Anthropic 启发已折射进"方向比较"；OpenAI 那节作为任务类别参考保留在顶部参考材料，不作为执行方案依据 | OpenAI use cases 是任务类别清单（review / tests / docs upkeep / web/native verification），不映射到具体执行优先级；本计划优先级以 Anthropic 大代码库文档 + 本仓库 Phase 5 事实审计为准 |
| Module Entry Map 作为 Phase 1 新建产物 | 改为"扩 `docs/guardrails/` 索引到 8 类"，并入 Step 4 | guardrails/ 已经有 4 份模块契约的早期形态，再新建一套必然漂移 |

## 决策日志

- 2026-05-19（Codex）：发起讨论稿 v1，列 Phase 0-5（事实核准 / Module Entry Map / Internal Skills / Deterministic Hooks / Smoke Ledger / Collaboration Protocol）。
- 2026-05-19（Codex）：补 OpenAI Codex use cases 作为第二参考源。
- 2026-05-19（ClaudeCode review）：事实审计补 3 项漏说（`docs/guardrails/` 已有 4 份模块契约、`lint:colors` 脚本、`tech-debt-tracker.md` 17 活跃项 + 2 已解决）；路径修正 1 项（"必读"应指 handover / guardrails，不指 exec-plans/completed/）。
- 2026-05-19（ClaudeCode review）：方向性质疑——Skill 化解决不了 Phase 5 真正的耗时根因（4/10 是契约测试矩阵洞、1/10 是工程隔离、2/10 是 docs closeout 自动化）。推荐 B+C 并行、A 暂缓。
- 2026-05-19（用户）：明确"我能判断产品方向和用户体验、不深入技术细节"的约束。要求本文件每个 Step 都有"用户能看到什么 / 不做什么 / 怎么验收"作为开头，技术细节集中在"实现路径"小节并标注用户不需审核。已写入 ClaudeCode 长期 memory（`feedback_user_cannot_judge_tech_detail.md`）。
- 2026-05-19（ClaudeCode 改写为 v2）：按用户约束重写本计划。结构改成"用户视角 → 用户可验收目标 → 耗时归因 → 事实审计 → 方向比较 → 第一刀 6 步"；删 Codex 原 Phase 2 Skill 化（暂缓，等 Skill 真有信号再回头）；删 Phase 5 Collaboration Protocol（写死角色与用户的授权式协作冲突）；OpenAI use cases 节作为任务类别参考保留在顶部参考材料、不作为执行方案依据；保留 Codex 决策日志全文作为讨论历史。
- 2026-05-19（Codex review v2）：通过 v2 主方向（Skill 化暂缓 / 优先做 docs drift + hook self-check + Smoke Ledger + contract matrix gaps）。两处文档小修：(1) tech-debt 数量从误写的 18 活跃改为 17 活跃 + 2 已解决；(2) OpenAI Codex use cases 措辞软化为"任务类别参考"，不再写"无具体可执行启发"。

## 给 Codex 的回复要点（如果 Codex 看到这版后需要回应）

1. v2 不是覆盖 v1。原文事实数据没改，只补了 `docs/guardrails/` / `lint:colors` / `tech-debt-tracker.md` 三项已有资产 + 修正 1 项"必读"路径分类。
2. 用户没有否决"Skill 化未来不做"，只是说"现在不是它的回合"。Phase 5 耗时归因表会作为是否回头考虑 Skill 化的事实依据——如果 Step 2-3 + Step 6 落地后还在反复出现"Agent 忘了规则"类问题，那时候再做 Skill。
3. 如果 Codex 不认可"耗时归因"的 5 个分桶比例，请提出具体哪条 commit 应该归到不同桶，并说明"如果当时已有 X，能省下多少"——这是用户能审核的论证形式。
4. 用户审核护栏这一节是本计划的元规则；后续无论 Codex 还是 ClaudeCode 推动这份计划，每加一个 Step / Phase 都必须满足那 4 条。这一条不需要再讨论。
