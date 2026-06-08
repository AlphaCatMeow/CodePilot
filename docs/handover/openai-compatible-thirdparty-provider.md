# OpenAI 兼容第三方服务商

> 产品思考见 [docs/insights/openai-compatible-thirdparty-provider.md](../insights/openai-compatible-thirdparty-provider.md)

## 概述

OpenAI 兼容第三方服务商是一个 chat 类 Provider preset，用于接入支持 OpenAI-compatible `/v1` 协议的第三方网关、中转服务和自托管代理。用户在 `设置 > 服务商` 的“第三方 / 中转兼容”分类中选择 `OpenAI-compatible Third-party`，填写 `base_url` 与 `api_key` 后，CodePilot 复用现有连接测试、模型发现、模型管理和聊天 Runtime 链路完成接入。

本功能不新增 Runtime、不新增数据库字段、不新增模型管理页面。它把 `protocol='openai-compatible'` 正确接入既有 Provider 架构。

## Provider 接入

入口由 `src/lib/provider-catalog.ts` 的 `openai-compatible-thirdparty` preset 提供：

- `protocol: 'openai-compatible'`
- `provider_type: 'openai-compatible'`
- `authStyle: 'api_key'`
- `fields: ['name', 'api_key', 'base_url']`
- `category: 'chat'`
- `iconKey: 'openai'`

前端 `src/components/settings/provider-presets.tsx` 从 `VENDOR_PRESETS` 生成 Add Service 卡片。`toQuickPreset()` 对 `openai-compatible` 保留同名 `provider_type`，避免历史兜底把它写成 `anthropic`。编辑时 `findMatchingPreset()` 也优先按 `provider_type` 或 `protocol` 识别该 preset，避免 `https://api.openai.com/v1` 被误匹配到 `openai-image` 图片服务。

服务端 `findMatchingPresetForRecord()` 同样优先识别 `provider_type='openai-compatible'`，因此 Provider Card、Models 页、模型发现、Runtime compatibility 都能得到一致的 catalog 判断。

## Base URL 规则

Base URL 的共享规则在 `src/lib/provider-openai-compatible.ts`：

- 空值直接拒绝
- 仅允许 `http` / `https`
- 不允许 query string 或 hash
- 纯 host 会保存为 `/v1` endpoint，例如 `https://api.example.com` → `https://api.example.com/v1`
- 带自定义 path 时必须以 `/v1` 结尾，例如 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 带自定义 path 但不以 `/v1` 结尾会拒绝，避免模型发现与聊天请求猜不同路径

`POST /api/providers` 和 `PUT /api/providers/[id]` 都调用这个 helper。UI 的 `PresetConnectDialog` 也在保存前调用同一 helper，并在输入框下提示用户填写 OpenAI-compatible `/v1` endpoint。

## 连接测试

连接测试仍走现有 `POST /api/providers/test`，没有新增 API。

`testProviderConnection()` 增加 `protocol === 'openai-compatible'` 分支后，会执行：

```text
GET {normalizedBaseUrl}/models
Authorization: Bearer {apiKey}
```

成功条件是 HTTP 2xx，并且响应体能解析出 OpenAI-compatible 模型列表结构 `data[].id`。这个 probe 不发送 Anthropic `/v1/messages` 请求，不带 `anthropic-version`，也不使用 `x-api-key`，避免把 OpenAI-compatible 服务误按 Anthropic 协议测试。

编辑已有服务商时，`/api/providers/test` 继续沿用 `providerId` 回填已保存密钥的机制。用户没有改动密钥时，前端不会把 masked key 发给上游。

## 模型发现与模型管理

保存成功后，ProviderManager 继续调用现有 `runAutoDiscoverForProvider()`：

```text
runAutoDiscoverForProvider()
  -> POST /api/providers/{id}/discover-models
  -> discoverModels()
  -> GET {normalizedBaseUrl}/models
  -> diff against provider_models
  -> POST /api/providers/{id}/discover-models/apply
  -> applyDiscoveryDiff()
```

`canReliablyFetchModels()` 对该 preset 返回 reliable，因此 Models 页会显示刷新能力。`applyDiscoveryDiff()` 仍是唯一写入点，继续保护 `manual_enabled` 和 `manual_hidden`，不会覆盖用户在 Models 页做过的启用/隐藏选择。

generic OpenAI-compatible provider 没有内置默认模型白名单。上游 `/v1/models` 返回的模型会进入 `provider_models` inventory。系统仍用 `isRecommendedModel()` 的保守启用策略，明显非聊天模型、embedding、image、audio、preview、deprecated、test、free 等不会默认进入 chat picker。发现到模型但没有任何默认启用项时，toast 会明确提示用户到 Models 页启用需要用于聊天的模型。

## 聊天与 Runtime

聊天链路没有新增分支：

```text
chat picker
  -> /api/providers/models
  -> /api/chat
  -> resolveProviderForSession()
  -> streamClaude()
  -> CodePilot Runtime / Codex provider proxy
  -> createModel()
  -> @ai-sdk/openai
```

`toAiSdkConfig()` 对 `protocol='openai-compatible'` 输出 `sdkType: 'openai'`，使用归一化后的 `/v1` base URL，并设置 `forceChatCompletions: true`。`createModel()` 继续由 `@ai-sdk/openai` 创建 language model，但该类第三方网关固定调用 `openai.chat(modelId)`，避免 AI SDK 因 `gpt-5` / `gpt-5.5` 这类模型名自动切到 OpenAI Responses API。

这个分支只约束 OpenAI-compatible 第三方网关的 SDK endpoint 选择，不新增 Runtime，也不影响 OpenAI OAuth / Codex API 的 `useResponsesApi` 路径。原因是通用第三方/中转服务通常宣称兼容 OpenAI `/v1/chat/completions`，即使模型名像官方 Responses 模型，也可能只返回 `chat.completion.chunk` SSE；如果误走 `/responses`，二轮工具调用会触发 `previous_response_id` / `function_call_output` 续写语义并被网关拒绝。

Provider compatibility 由 `getProviderCompat()` 返回 `codepilot_only`。模型层的 `getModelCompat()` 会把 chat 模型暴露给 CodePilot Runtime 和 Codex Runtime provider proxy；Claude Code Runtime 不作为该 Provider 的主路径，UI 继续按既有 runtime compatibility 规则展示不可用原因。

技能调用、MCP、联网、记忆和自动压缩上下文都继承 `/api/chat` 现有链路：

- 上下文拼装：`assembleContext()`
- MCP 加载：Native/CodePilot Runtime 走 `loadAllMcpServers()`
- 工具组装：`assembleTools()`
- 自动压缩：context compressor 与 session summary 机制
- SSE 输出：沿用 `streamClaude()` 与 Runtime SSE contract

## 测试覆盖

核心单测在 `src/__tests__/unit/openai-compatible-thirdparty-provider.test.ts`：

- preset schema、协议推断、preset 匹配、runtime compat、模型发现可靠性
- OpenAI-compatible Base URL 归一化与非法 path 拒绝
- `POST /api/providers` 与 `PUT /api/providers/[id]` 的写入防线
- `testProviderConnection()` 使用 `GET /models` 和 Bearer auth，不带 Anthropic headers
- `toAiSdkConfig()` 对 GPT-5-like 第三方模型设置 `forceChatCompletions: true`，防止误走 Responses API

相关既有测试继续覆盖：

- `provider-preset.test.ts`：catalog schema 与 chat/image 协议隔离
- `apply-discovery-diff.test.ts`：模型发现写入与 manual override 保护
- `provider-model-roundtrip.test.ts`：模型 picker 与 provider model round-trip
- `runtime-compat-supported-runtimes.test.ts`：runtime compatibility contract

## 维护注意

不要把 `openai-image-thirdparty` 复用于聊天 Provider。图片服务商使用 `protocol='openai-image'`，模型列表和生成 API 都是媒体专属语义；chat provider 必须保持 `protocol='openai-compatible'`。

不要绕过 `provider-openai-compatible.ts` 自己拼 `/v1`。保存、测试、模型发现和 Runtime 请求必须使用同一套 URL 规则。

不要为该 Provider 新增独立模型列表或聊天请求路径。模型库存以 `provider_models` 为事实源，聊天以 `/api/chat` 和 `createModel()` 为事实源。
