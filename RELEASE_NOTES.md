## CodePilot v0.56.0

> 本次更新的部分修复由 Claude Fable 5 完成。
>
> 模型与渠道扩充版本：新增 Claude Fable 5、小米 MiMo UltraSpeed 模型与通用 OpenAI 兼容第三方渠道，并修复用量统计、回复状态丢失、服务商列表刷新等一批问题。推荐所有用户升级。

### 新增功能

- **支持 Claude Fable 5** — Anthropic 最新发布的旗舰模型（定位在 Opus 之上），在 Anthropic 官方服务商和内置 Claude Code 模式下均可选用，支持 1M 上下文窗口与全部思考深度（Effort）档位。注意官方定价为 Opus 4.8 的两倍，请按需选用。
- **小米 MiMo 新增 UltraSpeed 超高速模型** — MiMo 渠道可选用 `mimo-v2.5-pro-ultraspeed`（官方超高速体验模式，资源有限、按日审批）；默认模型保持不变，不影响现有会话。
- **通用 OpenAI 兼容第三方渠道** — 设置 > 服务商中可以新增任意 OpenAI 协议兼容的网关：填入 Base URL、API Key 和模型名即可在 CodePilot 与 Codex 引擎中使用（Claude Code 引擎不支持此类渠道，界面有明确标注）。

### 修复问题

- 修复对话中途出错时，该轮 token 用量不计入统计的问题——此前成本和上下文用量会被悄悄低估。
- 修复回复结束后切换会话或长时间挂机回来，完成状态（终止原因、用量信息）丢失的问题。
- 修复编辑或删除服务商后，聊天页的模型列表最长要等 5 分钟才更新的问题，现在立即生效。
- 修复模型选择器「Claude Code」分组一直缺少 Opus 4.8 的问题（本次随 Fable 5 接入一并补齐）。
- 修复早期版本创建的 OpenAI 兼容服务商可能在应用重启后丢失的问题。

### 优化改进

- 选用 Fable 5 且设置了「关闭思考」时，会明确提示该模型思考始终开启（官方限制），不再静默忽略你的设置；思考深度可改用 Effort 调节。
- 运行中的命令实时输出窗口不再从半行中间开始显示。

### 已知问题

以下问题已记录、不影响主流程，仍在跟进（欢迎到 GitHub Issues 反馈复现细节）：

- 新增的 OpenAI 兼容渠道与 MiMo UltraSpeed 已通过完整自动化测试，真实第三方网关 / 审批 key 的端到端验证仍在补充中，遇到接入问题请反馈。
- Windows 上服务商编辑窗口右上角关闭按钮在个别情况下点击无反应（仍在 Windows 真机验证中）。
- 流式回复期间继续追加消息进队列的行为异常（核查中）。
- MCP 在设置页能看到，但运行时模型调不到，需要把 MCP 配置到项目路径才识别（排查中）。

**反馈入口**：欢迎在 [GitHub Issues](https://github.com/op7418/CodePilot/issues) 提交问题与复现步骤。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.56.0/CodePilot-0.56.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.56.0/CodePilot-0.56.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.56.0/CodePilot.Setup.0.56.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
