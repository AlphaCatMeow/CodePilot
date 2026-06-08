# OpenAI 兼容第三方服务商产品思考

> 技术实现见 [docs/handover/openai-compatible-thirdparty-provider.md](../handover/openai-compatible-thirdparty-provider.md)

## 概述

很多用户同时使用多个第三方模型服务商、中转网关或团队内部代理。这些服务通常宣称“OpenAI 兼容”，但每家控制台给出的 endpoint、模型 ID 和可用模型列表都不同。用户真正需要的是一个稳定的配置入口：填对 `base_url` 和 `api_key`，验证能连通，拉取账号能用的模型，然后在聊天里自然选择。

本功能把 OpenAI-compatible 第三方服务商放进 `设置 > 服务商` 的“第三方 / 中转兼容”分类，并让 Models 页继续承担“哪些模型暴露给聊天”的职责。

## 解决的问题

用户配置第三方服务商时最容易卡在 3 件事：

- 不知道 `base_url` 应该填域名、`/v1` 还是厂商自定义 path
- 不确定 API Key 是否真的能连上该服务
- 服务商返回大量模型后，不知道哪些会进入聊天选择器

新入口把这些问题拆开处理。Provider 设置窗口只负责连接服务，Models 页负责模型暴露，聊天页只消费已经启用的模型。这样用户不会在一个窗口里同时面对凭证、模型白名单、Runtime、工具能力和上下文策略。

## 设计取舍

### 复用 Provider preset，而不是做独立服务商管理器

OpenAI-compatible 第三方服务商本质上仍是 Provider。它需要参与已有的 Provider Card、模型发现、Runtime compatibility、chat picker 和 `/api/chat` 请求链路。如果另做一个独立管理器，就会出现两套凭证、两套模型列表、两套路由规则，用户看到的“已连接服务”和聊天实际使用的服务也容易分叉。

因此本功能只新增一个 catalog preset，并让它进入现有 Add Service 体验。

### 强制 `/v1` endpoint，而不是猜测所有路径

OpenAI-compatible 服务商的 API path 差异很大。有些是 `https://api.example.com/v1`，有些是 `https://dashscope.aliyuncs.com/compatible-mode/v1`。如果系统遇到自定义 path 后继续猜 `/v1`，可能让模型发现打到一个路径、聊天请求打到另一个路径，错误会非常隐蔽。

所以规则是：纯 host 可以自动补 `/v1`；一旦用户填写了自定义 path，就必须以 `/v1` 结尾。这个规则更严格，但失败更早，错误也更可解释。

### 不默认启用所有发现模型

很多 OpenAI-compatible 服务会在 `/v1/models` 返回 embedding、image、audio、rerank、preview、deprecated 或测试模型。把这些全部塞进聊天选择器，会让用户在发送时遇到非聊天模型错误，也会让模型列表变得很难扫描。

因此发现到的模型会进入 Models inventory，但默认启用仍走保守推荐策略。用户可以在 Models 页启用自己确认可用于聊天的模型。发现到模型但没有默认启用项时，系统会明确提示“已保存到模型管理，请启用需要用于聊天的模型”。

### 固定使用 Chat Completions，而不是按模型名推断 Responses

第三方/中转服务承诺的兼容面通常是 OpenAI `/v1/chat/completions`，不是官方 OpenAI Responses API。即使服务商暴露了 `gpt-5`、`gpt-5.5` 这类模型名，也不能据此判断它支持 Responses SSE 事件、`previous_response_id` 或 Responses 工具续写语义。

因此通用 OpenAI-compatible 第三方服务固定走 Chat Completions。这样更符合用户对“OpenAI 兼容”的预期，也能避免首轮普通对话成功、二轮工具调用失败的体验断层。官方 OpenAI OAuth / Codex API 仍保留自己的 Responses 路径，不和第三方兼容入口混用。

### 不复用图片 OpenAI preset

`openai-image-thirdparty` 是媒体服务商，面向图片生成模型和媒体生成链路。OpenAI-compatible chat provider 面向 language model、工具调用和聊天 Runtime。两者可能共享 `https://api.openai.com/v1` 这样的 URL，但协议语义、模型列表和消费链路不同。

把图片 preset 复用到 chat provider 会污染模型列表，也会让用户误以为图片模型能进入聊天。

## 用户路径

1. 用户打开 `设置 > 服务商`
2. 点击“添加服务”
3. 在“第三方 / 中转兼容”中选择 `OpenAI 兼容第三方`
4. 填写名称、Base URL、API Key
5. 点击“测试连接”
6. 保存后系统自动发现模型
7. 用户进入 `设置 > 模型管理` 启用需要用于聊天的模型
8. 聊天界面选择该服务商和模型
9. 后续对话、技能调用、联网、记忆和自动压缩上下文沿用现有聊天链路

## 边界

本功能不解决每个服务商的私有认证方式。默认只支持 OpenAI-compatible 常见的 Bearer token。需要自定义 header 的高级用户可以在编辑模式使用已有 `headers_json`。

本功能不保证 `/v1/models` 返回的每个模型都能聊天。模型列表是服务商暴露的 inventory，能否用于聊天仍取决于服务商模型能力、账号权限和用户在 Models 页的启用选择。

本功能不新增 Claude Code Runtime 适配。OpenAI-compatible chat provider 主要走 CodePilot Runtime 和 Codex provider proxy；Claude Code Runtime 继续由 Anthropic-compatible provider 承担。

## 后续方向

可以在后续版本补更细的模型能力识别，例如根据模型 ID 或服务商返回 metadata 标注 embedding、image、rerank 等类型。但这需要真实来源，不能用固定估值或假能力。

可以在连接窗口提供常见服务商 Base URL 示例库，但不应把示例库变成新的 Provider catalog。示例只帮助填 URL，实际模型和能力仍以模型发现与 Models 页为准。
