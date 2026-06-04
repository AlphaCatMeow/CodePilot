# StreamSession Guardrail

> **Status: Stub** — 七节模板占位。首次真实改动触发时由实施 Agent 按 [`README.md`](./README.md) 的七节模板填充。
> **为什么先读**：聊天主路径——双入口（`/chat` page.tsx 首消息 + `/chat/[id]` ChatView.tsx 后续）必须**独立**管理 effort / thinking / runtime override 并各自向 `/api/chat` 传递。这是上一次 SDK 0.2.111 接入的重灾区，也是即将到来的 Phase 6 上下文可视化的主要触及点。
> **已知关键文件**：`src/lib/claude-client.ts`、`src/lib/stream-session-manager.ts`、`src/hooks/useSSEStream.ts`、`src/app/chat/page.tsx`、`src/components/chat/ChatView.tsx`。

## 词汇表

- `stream-session-manager` — 客户端流会话状态机（startedAt / snapshot / finalMessageContent）。
- `useSSEStream` — Server-Sent Events 解析 hook。
- `rewind point` — prompt-level user message 的回退锚点（不为 tool_result / autoTrigger 触发）。

## 不变量 / 契约表

| # | 不变量 | 由谁守 |
|---|--------|--------|
| 1 | `/chat` 首消息和 `/chat/[id]` 后续消息**各自独立**管理 effort / thinking 状态并都传给 `/api/chat`，不依赖跨 page 共享状态 | page.tsx + ChatView.tsx |
| 2 | Rewind point 仅对 prompt-level user message（`parent_tool_use_id === null`）发出；autoTrigger / tool_result 不发 | `useSSEStream.ts` |
| 3 | Capability cache 必须 per-provider（`Map<string, ProviderCapabilityCache>`），所有调用者显式传 providerId | `src/lib/agent-sdk-capabilities.ts` |

## 关键文件 + 责任

| 文件 | 守哪条不变量 |
|------|--------------|
| `src/lib/claude-client.ts` | SDK streaming core + capProviderId 派生 |
| `src/lib/stream-session-manager.ts` | snapshot 生命周期 |
| `src/hooks/useSSEStream.ts` | SSE 事件解析 + rewind point 发出规则 |
| `src/app/chat/page.tsx` | 首消息入口 |
| `src/components/chat/ChatView.tsx` | 后续消息入口 |

## 改动检查表

- [ ] 改 capability 相关代码时确认 providerId 显式传递，不依赖全局缓存
- [ ] 改 rewind 逻辑时确认 autoTrigger / tool_result 不被错误触发
- [ ] 改首消息 page 时同步检查 ChatView.tsx 是否独立持有同一状态
- [ ] snapshot clear 行为改动时确认长 idle 后 getSnapshot() 不返回 null（见已知 bug）

## 常见坑

- `clearSnapshot()` 重置 `startedAt: 0`；用户长 idle 后返回时 `getSnapshot()` 返回 null，导致输出不显示（memory "Known Bugs" 已记录）。
- 不要在 `/chat` 和 `/chat/[id]` 之间共享 effort/thinking state—两边都必须独立持有。

## 测试覆盖

| 契约 | 测试文件 |
|------|----------|
| Rewind emission | `session-runtime-immunity.test.ts` 等 |
| | （待填充） |

## 设计决策日志

- 已实现：SDK Capabilities Integration 5 阶段（详见 `sdk-integration.md`）。
- 待修：长 idle 后输出不显示——keep finalMessageContent in snapshot even after clear，或从 DB 还原。
