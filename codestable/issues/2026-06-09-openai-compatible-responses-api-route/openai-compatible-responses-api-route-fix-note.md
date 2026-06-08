---
doc_type: issue-fix
slug: openai-compatible-responses-api-route
severity: P1
status: fixed
tags:
  - provider
  - openai-compatible
  - runtime
  - tools
found_at: 2026-06-09
fixed_at: 2026-06-09
---

# OpenAI-compatible 第三方服务误走 Responses API 修复记录

## Signal

用户在 Electron 调试版中手动验证 `OpenAI 兼容第三方` Provider：

- 服务商配置、连接测试、模型拉取和首轮聊天成功。
- 第二轮对话要求读取项目源码时，聊天界面返回 `AI_TypeValidationError`，上游 SSE chunk 为 `object: "chat.completion.chunk"`。
- 随后出现 `AI_APICallError: function_call_output requires item_reference ids matching each call_id on HTTP requests; continuation via previous_response_id is only supported on Responses WebSocket v2`。

## 根因

`protocol='openai-compatible'` 会在 `toAiSdkConfig()` 中输出 `sdkType: 'openai'`，随后 `src/lib/ai-provider.ts` 调用 `openai(config.modelId)`。

`@ai-sdk/openai` 会根据模型名选择默认 endpoint。对 `gpt-5.5` 这类 GPT-5-like 模型名，默认 provider 会创建 `openai.responses` 模型，导致 CodePilot 以 Responses API 语义继续二轮工具调用。

第三方/中转服务实际只返回 OpenAI Chat Completions SSE，例如 `chat.completion.chunk`，并不支持 Responses SSE 事件、`previous_response_id` 或 Responses 的工具续写协议，所以二轮工具调用失败。

## 修复

- `src/lib/provider-resolver.ts`
  - `AiSdkConfig` 增加 `forceChatCompletions?: boolean`。
  - `protocol='openai-compatible'` 的配置固定设置 `forceChatCompletions: true`。
  - OpenRouter OpenAI skin（`/api/v1`）以及 Bedrock / Vertex 的 OpenAI-compatible proxy 分支同样设置 `forceChatCompletions: true`，避免同一类 SDK 默认 Responses 路由在其他 OpenAI-skin 入口复现。
- `src/lib/ai-provider.ts`
  - OpenAI SDK 路径在非 `useResponsesApi` 且 `forceChatCompletions` 为 true 时调用 `openai.chat(config.modelId)`。
  - OpenAI OAuth / Codex API 的 `useResponsesApi` 路径保持不变。
- `src/__tests__/unit/openai-compatible-thirdparty-provider.test.ts`
  - 增加 GPT-5-like 模型名测试，断言 OpenAI-compatible 第三方服务设置 `forceChatCompletions: true` 且不设置 `useResponsesApi`。
- `src/__tests__/unit/provider-resolver.test.ts`
  - 既有 openai-compatible resolver 测试增加 Chat Completions 路由断言。
  - 增加 OpenRouter OpenAI skin、空 base URL 默认 OpenAI skin、Bedrock proxy、Vertex proxy 的 Chat Completions 路由断言。
- `docs/handover/openai-compatible-thirdparty-provider.md`
  - 补充 Chat Completions 强制路由说明。
- `docs/insights/openai-compatible-thirdparty-provider.md`
  - 补充为什么不按模型名推断 Responses API。

## 防回归

以后新增 OpenAI-compatible 类 Provider 时，不应直接依赖 `openai(modelId)` 的自动 endpoint 选择。通用第三方/中转兼容入口默认承诺的是 `/v1/chat/completions`，只有官方 OpenAI OAuth / Codex API 这类明确支持 Responses 的路径才应设置 `useResponsesApi`。

## 验证

待运行：

- `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/openai-compatible-thirdparty-provider.test.ts src/__tests__/unit/provider-preset.test.ts`：107 tests passed。
- `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/provider-resolver.test.ts src/__tests__/unit/provider-model-roundtrip.test.ts src/__tests__/unit/runtime-compat-supported-runtimes.test.ts src/__tests__/unit/apply-discovery-diff.test.ts`：165 tests passed。
- `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/provider-resolver.test.ts src/__tests__/unit/openai-compatible-thirdparty-provider.test.ts src/__tests__/unit/provider-preset.test.ts`：233 tests passed。
- `npm run typecheck`：passed。
- Electron 调试版人工二轮对话回归：`POST /api/chat 200 in 2.0min`，未再出现 `AI_TypeValidationError` / `function_call_output` 400。
