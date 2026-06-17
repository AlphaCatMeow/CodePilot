## CodePilot v0.56.1-alphacat.1

> AlphaCat 个人 Fork 练习版本。
>
> 本项目 Fork 自归藏开发的 CodePilot。商业授权请联系原作者归藏获取；当前 Fork 仅用于个人学习、VibeCoding 练手和自用习惯调整，不用于也不接受任何商业用途。

### 本次重点

- 修复聊天消息里接口已返回完整 base64 图片，但前端渲染层把图片整体屏蔽导致无法显示的问题。
- 完善聊天界面的生成图片体验：支持点击查看大图、点击空白处关闭 lightbox、保存到本地、添加到素材库。
- 重新梳理素材库图片存储逻辑：生成图片先落到缓存文件，加入素材库后以文件路径和元数据管理，素材库展示缩略图并指向真实图片文件。
- 修复素材库提示词归属错误：素材库现在使用真正发送给接口的生图提示词，不再错误显示为 `image_1` 或串到其他图片。
- 调整收藏与素材库语义：收藏不再等同于加入素材库；大图中提供收藏、下载、添加到素材库等独立操作。
- 修复从素材库移出图片后列表没有及时移除的问题，并将素材库大图里的删除操作文案调整为“移出素材库”。
- 修复 Joverna / OpenAI 兼容图像返回链路，支持通过 `chat/completions` 接口接收并展示图像数据。
- 调整生图交互入口：当用户选择生图模型或直接生图模式时，可更顺畅地调用 Krill / `gpt-image-2` 这类图像生成能力。
- 修复 Joverna 连接测试与保存配置时的卡顿问题。
- 新增 GitHub Actions 推送构建流程，推送到 `main` 后自动验证源码并构建 Windows、macOS、Linux artifacts。
- 固定 CI Node.js 构建环境为 `22.16.0`，并将 Windows runner 固定到 `windows-2022`，避免 `zlib-sync` / `node-gyp` 在 GitHub Actions 上因环境漂移安装失败。

### 构建与发布

- `main` 分支推送会触发 `Push Build`，产出 Windows、macOS arm64、Linux artifacts，但不会创建 GitHub Release。
- 正式 Release 由 `v*` tag 触发，本版本 tag 为 `v0.56.1-alphacat.1`。
- Release workflow 会构建并上传 macOS arm64 / x64 安装包与 Windows x64 安装包，并生成 SHA-256 校验文件。

### 下载地址

发布完成后可在当前仓库 Release 页面下载：

- [CodePilot Releases](https://github.com/AlphaCatMeow/CodePilot/releases)

### 已知说明

- 当前 Fork 面向个人自用习惯调整，不承诺与上游 Release 节奏保持同步。
- macOS 包为未签名构建，首次启动如遇系统安全提示，需要在系统设置中手动允许打开。
- 生成图片能力依赖已配置的服务商、模型和 API 兼容性；不同 OpenAI 兼容网关返回图像的格式可能不同。

