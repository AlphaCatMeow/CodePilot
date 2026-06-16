# 工作记录 — CodePilot 发布前功能验证 & 生图修复

> 用途：承接跨对话上下文。靠这份记录**精确恢复被中断的工作**。
> **每次恢复，第一动作是读「恢复指令」+ 用 `git status` 核对真实状态，再继续。**

- **总目标**：合并 upstream/main 后，发布前由作者手动验证所有功能；聊天消息里的 Markdown base64 图片渲染问题已修，Joverna chat/completions 生图已跑通。当前已完成“聊天生成图片资产化” Phase 1：聊天图片可点开大图、保存到本地、收藏到素材库，且素材库保存文件路径而非 base64。最终 push + 发版均需作者明确指示。
- **当前任务**：Phase 1 已实现并验证；Phase 2（缩略图生成与缓存清理）仍待后续。执行计划见 `docs/exec-plans/active/chat-generated-image-assets.md`，checklist 见同目录 `chat-generated-image-assets-checklist.yaml`。
- **上一个完成的动作**：新增 `chat_media_assets` schema、`src/lib/chat-media-assets.ts`、`/api/chat/media-assets/*` 创建/读取/promote API；`ImageLightbox` 改为 asset-aware，Markdown data image 点击打开大图后可收藏；旧 spike `/api/media/save` 已删除。随后修复 prompt 错误：Markdown 图片 `alt=image_1` 不再作为素材库 prompt，`MessageList` 会把上一条用户消息作为 `imagePromptHint` 传入 `MessageItem`/`StreamingMessage`，`ChatImg` 再传给 lightbox/asset API；复用旧 asset 时若旧 prompt 是 `image_1` 会修正 asset 与 media row。UI smoke：新素材记录 `8da8f3ce2c239a55af290f44b2d1da66` prompt 已是 `生成一张海报图，主题是凤凰传奇演唱会即将在上海体育场举办，比例9:16`；本地旧 smoke 记录 `d3ee33d42f27caa2f8ab5491e83e3677` 也已回填同一真实 prompt。
- **下一步第一个动作**：如继续该功能，进入 Phase 2：评估缩略图生成方案、给 `media_generations.thumbnail_path` 写入缩略图、素材库列表优先展示缩略图、增加未 promoted cache 的 GC 策略。若先做发布前验证，重点回归 Joverna 生成图 → 点击大图 → 收藏 → 素材库可见。
- **新对话恢复检查清单**：①读本节 + `git status` 核对真实状态 ②注意当前工作树里已有 `package.json` 修改和 `debug-electron.log` 未跟踪文件，均为前序残留，不要擅自提交或删除 ③Markdown 图片修复已验证：`npx tsx --test src/__tests__/unit/chat-markdown-data-image.test.ts` 通过；`npm run test` 的 typecheck 通过但 Windows 下 `CODEX_DISABLED=1` 脚本语法失败，PowerShell 等价 unit suite 卡在既有 `agent-task-runner.test.ts` 路径问题 ④若继续发布前验证，先确认临时 `[debug-session]` / `[image-debug]` 日志是否需要清理。
- **当前假设/约束/待确认**：
  - 已确认根因：`rehype-sanitize` 在 `rehype-harden` 前删除 `data:image/...` 的 `img.src`，导致 harden 输出 `[Image blocked: ...]`。
  - 已修复安全边界：只放行 base64 raster image data URI；不放宽 link href、HTML raw、任意 `data:` 或 svg。
  - 已纠正错误判断：OpenAI-compatible provider 下的 `gpt-image-*` / `gemini-*-image` 等模型不应按模型名判为 media-only；这类 provider 可能通过 chat/completions 直接返回图片数据。
  - 已确认 Joverna key/base_url 本身可用：服务端直连会 `ECONNRESET`，经本机代理 `127.0.0.1:7890` 可访问；因此外部 provider 请求要使用代理感知 fetch，但不能用全局 dispatcher 影响本地 API 路由。
  - 已确认本轮设计重点：聊天图片资产生命周期比单纯 lightbox 更复杂；素材库 DB 不保存 base64，只保存图片文件路径和元数据。
  - Phase 1 采用已确认取舍：懒资产化；聊天 lightbox 收藏是“确保收藏”；promote 复制 cache 文件到 `.codepilot-media`；缩略图放 Phase 2。
  - 自动下载验证限制：Codex In-app Browser 不支持 download event，保存按钮未做自动下载事件验证；相关代码路径为 fetch 当前 src/contentUrl 后触发 `<a download>`，asset content route 已有单测。
  - 生图调试链路仍保留：调试日志和转发器都标了 `[debug-session]` / TEMPORARY，发布前要清理。

## 生图调试启动命令（当前不优先；待作者下令才执行；端口默认 3000，主目录无 worktree）
```bash
# 后台启动 electron:dev，三股输出（next 后端 + esbuild + electron 主进程含渲染进程转发）合并到日志文件
npm run electron:dev > debug-electron.log 2>&1 &
# 然后 tail -f debug-electron.log 看 [image-debug] / [renderer:*] / [media/generate] 输出
```
注：electron:dev 会先 one-shot 构建 dist-electron，再 concurrently 起 next dev + esbuild watch + electron。

## 未提交改动 & 验证边界
- **最近 checkpoint commit**：无（调试日志尚未 commit；合并 commit 是 9ae4a60，已落本地未 push）
- **未提交的改动**：
  - src/lib/image-generator.ts（`[image-debug]` 日志 + 上游错误捕获）
  - src/app/api/media/generate/route.ts（错误 stack/cause 日志）
  - electron/main.ts（渲染进程 console 转发器，仅 dev）
  - dist-electron/main.js、dist-electron/preload.js（重建产物）
  - docs/worklog/WORKLOG.md（本文件，新增）
- **已验证**：typecheck 干净；转发器已编译进 dist-electron/main.js
- **未验证**：electron:dev 实际启动、生图实跑（等作者操作）

## 关键决策（只增不删）
- 2026-06-15：调试运行方式选 electron:dev 完整桌面（作者选），而非 next dev。理由：要能测 native 集成 + 最接近发布形态。
- 2026-06-15：加临时详细调试日志（作者选），而非仅靠现有 console.log。理由：生图链路原有日志太少，失败时无法定位是 provider 选择、model 解析还是上游 API 报错。
- 2026-06-15：生图调试日志严禁打 api_key，只打 id/type/base_url/hasKey。

## 历程（按时间正序追加）
### 2026-06-15 — 合并 upstream/main + 搭调试环境
- 做了：
  1. 合并 upstream/main（op7418/CodePilot v0.55.2..v0.56.0）9 个 commit 进 fork main，解决 4 处冲突（db.ts / provider-catalog.ts / ai-provider.ts / provider-preset.test.ts），统一 openai-compatible preset key，修复 findMatchingPresetForRecord 早返回。merge commit 9ae4a60，未 push。
  2. 搭生图调试环境：image-generator.ts + media/generate 加详细日志，electron/main.ts 加渲染进程 console 转发器，重建 dist-electron。
- 验证：typecheck 干净；provider 相关测试 272/272 过（合并阶段）；转发器已编译进 main.js。
- 遗留：electron:dev 未启动（等作者下令）；生图实跑未验证；调试日志/转发器待发布前清理。

### 2026-06-16 — 修复聊天 Markdown base64 图片被 Streamdown 屏蔽
- 做了：
  1. 定位根因：`rehype-sanitize` 默认 schema 在 `rehype-harden` 之前删除 `data:image/...` 的 `img.src`，导致 harden 输出 `[Image blocked: ...]`。
  2. 新增聊天专用 rehype 插件链：保留 Streamdown 默认 raw / harden，替换 sanitize schema 允许 `src:data`，并在 harden 前只放行 raster base64 data image（png/jpeg/jpg/webp/gif），继续阻断 svg、text/html、非 base64 data image 和 javascript link。
  3. `MessageResponse` 显式使用 `chatRehypePlugins`。
- 验证：
  - `npx tsx --test src/__tests__/unit/chat-markdown-data-image.test.ts` 通过。
  - `npm run test`：`tsc --noEmit` 通过；`test:unit` 在 Windows 下因 `CODEX_DISABLED=1` POSIX 语法失败。
  - PowerShell 等价相关测试集通过：`chat-markdown-data-image.test.ts`、`codex-tool-result-media.test.ts`、`codex-media-import.test.ts`、`sse-stream.test.ts`。
  - PowerShell 等价完整 unit suite 仍有既有失败：`agent-task-runner.test.ts` 试图读取 `src/__tests__/unit/db.ts`。
  - `npx next dev` 启动后浏览器打开 `/chat` 正常，console 无 error / warn。

### 2026-06-16 — 已撤回：按模型名过滤图片模型的错误尝试
- 做了：
  1. 根据 `debug-electron.log` 定位：用户提示“生成一张海报图...”走的是 `/api/chat`，Native runtime，`model=gpt-image-2`，未进入 `/api/media/generate` 或 `[image-debug]`。
  2. 查询真实 DB：会话 `464ed794fe5eb6b26aa2e5cc4428a62a` 保存 `model=gpt-image-2`，provider 是 `Joverna`（openai-compatible）；该 provider 的 `provider_models` 里启用了 `gemini-3.1-flash-image`、`gpt-image-2`、`grok-imagine-image-lite`，全是图片模型。
  3. 曾错误新增 image-only 模型 ID 识别，把 `gpt-image-*` 等按名称判成 media-only；作者指出 Joverna 正是通过 chat/completions 返回图片数据，这个分类错误。
  4. 已撤回该错误：`getModelCompat()` 不再按模型 ID 判 media-only；只有 provider 自身是 `openai-image/gemini-image` 才 media-only。`resolveProviderForSession()` 不再因模型名返回 `model-missing`。
- 验证：
  - `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/runtime-compat-supported-runtimes.test.ts` 通过。
  - `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/provider-resolver.test.ts` 通过。
  - `npx tsc --noEmit` 通过。
  - 调试服务 `GET /api/providers/models` 已重新返回 Joverna 和其三个 chat-compatible 图像模型。

### 2026-06-16 — 修复海报图生图请求空跑 thinking
- 做了：
  1. 读取 `debug-electron.log`，确认用户再次发送“生成一张海报图...”后，当前会话已经切到文本聊天模型 `mimo-v2.5-pro`，但 native runtime 工具列表没有 `codepilot_generate_image`，请求约 3.5 分钟后以 `finishReason=length` 空响应结束。
  2. 新增 `src/lib/media-intent.ts`，把媒体意图识别扩展到“海报 / 海报图 / 生图 / 文生图 / 出图 / 生成一张图 / draw poster”等说法，并让 Claude SDK 的媒体 MCP 门禁复用该 helper。
  3. 修复 native built-in media 工具注册：`createMediaTools()` 现在收到 `sessionId` 和 `workspacePath`，保证 `codepilot_generate_image` / `codepilot_import_media` 执行后能通过 side-channel 把 `MediaBlock` 配回当前聊天。
  4. 第一次重启后，日志里的 native tool list 仍缺 `codepilot_generate_image`；将 media 工具组从动态 `require('./media')` 改为静态 import，让 Next dev 运行时不能继续静默吞掉 media 组。
  5. 重启 `npm run electron:dev` 调试客户端，端口 `3000` 已重新监听。
- 验证：
  - `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/media-intent.test.ts` 通过。
  - `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/native-media-block-side-channel.test.ts` 通过。
  - `npx tsc --noEmit` 通过。
- 遗留：
  - 等作者在新调试客户端里重新发送同一句，由日志确认是否进入 `codepilot_generate_image` / `[image-debug]` / `tool_result.media`。

### 2026-06-17 — 修复 Joverna 测试连接走直连导致 ECONNRESET
- 做了：
  1. 读取 `debug-electron.log` 和 `/api/providers/test` 结果，确认 UI 失败不是 route 崩溃，而是业务返回 `NETWORK_UNREACHABLE`。
  2. 用同一 Joverna DB key 做直连/代理对照：直连 `/v1/models` 报 `TypeError fetch failed`，cause 为 `read ECONNRESET`；显式 `ProxyAgent('http://127.0.0.1:7890')` 返回 200，模型列表含 `gemini-3.1-flash-image / gpt-image-2 / grok-imagine-image-lite`。
  3. 第一版在 `src/instrumentation.ts` 的 Node runtime 注册阶段设置 undici 全局 dispatcher，虽然让测试连接通过，但会导致本地 Provider 保存接口卡在“保存中”；该方案已撤回。
  4. 当前方案新增 `src/lib/proxy-aware-fetch.ts`，只在外部 provider/API 请求上按 `HTTP_PROXY/HTTPS_PROXY` 挂 `ProxyAgent`，并对 `localhost/127.0.0.1/::1` 与 `NO_PROXY` 做绕过。
  5. 已接入 provider 测试连接、模型发现、OpenRouter catalog、AI SDK model factory、专用图片生成路径。
- 验证：
  - `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/instrumentation-shape.test.ts` 通过。
  - `npx tsc --noEmit` 通过。
  - 重启后调用 `/api/providers/test` 测 Joverna 返回 `{ "success": true }`。
  - 同一重启后调用 `PUT /api/providers/69cd19b3c911c911fdba2f43552acf6c` 返回 provider JSON，不再卡住保存。
- 遗留：
  - 仍需让作者在 Electron UI 里点击“测试连接”和“更新”做端到端确认。

### 2026-06-17 — 拆分聊天大图“添加到素材库”和“收藏”语义
- 做了：
  1. 修正聊天图片资产语义：`promoteChatMediaAsset()` 现在只把缓存图复制/登记到 `.codepilot-media` + `media_generations`，不再自动设置 `favorited = 1`。
  2. `ImageLightbox` 顶部工具拆成三个动作：保存到本地、添加到素材库、收藏。未入库图片只能添加到素材库，收藏按钮禁用；入库后“添加到素材库”显示为已添加并禁用，收藏按钮才可用。
  3. 更新 `chat-generated-image-assets` 执行计划和 checklist，把旧的“promote 自动收藏”描述改为“添加到素材库”和“收藏标记”分离。
- 验证：
  - `$env:CODEX_DISABLED='1'; npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/chat-media-assets.test.ts src/__tests__/unit/chat-markdown-data-image.test.ts` 通过。
  - `npx tsc --noEmit` 通过。
  - 内置浏览器验证 `http://localhost:3000/chat/464ed794fe5eb6b26aa2e5cc4428a62a`：打开最近海报图 lightbox 后显示“保存到本地 / 添加到素材库 / 收藏”；未入库时收藏禁用；点击添加后按钮变为“已添加到素材库”且收藏可用；点击收藏后按钮变为“已收藏”。
- 语义边界：
  - “取消收藏”只应清掉 `favorited`，不等于从素材库移除。
  - 后续若需要从素材库移除图片，应单独提供“从素材库移除/删除素材”动作，并处理数据库记录、真实文件、缩略图和 chat asset 关联。

### 2026-06-17 — 修复素材库按钮文案与聊天图片 prompt 串图
- 做了：
  1. 素材库详情页底部的危险操作从“删除/确认删除”改为“移出素材库/确认移出”，避免和“取消收藏”混淆。当前后端行为仍是移除 `media_generations` 记录并删除 `.codepilot-media` 文件。
  2. 修复 Markdown 图片资产缺少 `message_id` 的问题：`ChatImg` 现在从 `MessageItem` 接收并传递 `messageId/sessionId` 到 `ImageLightbox`，streaming 路径也传 `sessionId`。
  3. `createOrReuseChatMediaAsset()` 在带 `messageId` 时优先复用同消息 asset；若命中旧的 `message_id IS NULL` asset，会绑定到当前消息，并用当前消息真实 prompt 修正 `chat_media_assets` 和已关联 `media_generations`。
  4. 当前本地坏数据已通过 UI 路径修复：小猫图 sha `a411a825...455ac9a` 对应的 media row `d3ee33d42f27caa2f8ab5491e83e3677` 已从海报 prompt 修回 `生成一张小猫图`，并绑定 message `fea4d81d51ee5da5201951b0816ebc22`。
- 根因：
  - 之前 Markdown 图片资产创建没有传 `message_id`，服务端只能按 `session_id + sha256 + source` 复用；再叠加一次人工 smoke 回填，把第一张小猫图的旧 asset/media prompt 错改成海报 prompt。
- 验证：
  - `$env:CODEX_DISABLED='1'; npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/chat-media-assets.test.ts src/__tests__/unit/chat-markdown-data-image.test.ts` 通过。
  - `npx tsc --noEmit` 通过。
  - 内置浏览器验证：聊天页打开第一张小猫图，点击“添加到素材库”后 DB prompt 自动修正；素材库详情页危险按钮显示“移出素材库”。
