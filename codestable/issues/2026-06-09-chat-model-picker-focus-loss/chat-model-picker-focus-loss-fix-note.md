---
doc_type: issue-fix
slug: chat-model-picker-focus-loss
severity: P2
status: fixed
tags:
  - chat
  - focus
  - electron
  - model-picker
found_at: 2026-06-09
fixed_at: 2026-06-09
---

# 聊天模型选择后输入框无法重新获取焦点修复记录

## Signal

用户反馈：聊天界面选择其他模型后，输入框失去焦点，并且鼠标再次点击输入框也无法获取焦点。必须切换一次前台应用，再回到 CodePilot 后点击输入框才恢复正常。

## 根因

模型选择器 `ModelSelectorDropdown` 是自定义 transient dropdown。模型行使用 `CommandListItem` 渲染为 `<button>`。鼠标选择模型时，浏览器会先在 `mousedown` 阶段把焦点移动到该按钮；随后 `handleModelSelect()` 立即关闭菜单，导致这个刚获得焦点的按钮被卸载。

在普通浏览器中这通常只是回落到 `body`，但 Electron/Chromium 在该事件顺序下可能留下不稳定的焦点状态，表现为后续点击 textarea 不能立即获取输入焦点，需要应用前后台切换后恢复。

## 修复

- `src/components/patterns/CommandList.tsx`
  - `CommandListItem` 增加 `preventFocusOnMouseDown?: boolean`。
  - 启用时在 `onMouseDown` 中 `preventDefault()`，阻止 transient menu item 抢走 composer focus。
- `src/components/chat/ModelSelectorDropdown.tsx`
  - 模型行启用 `preventFocusOnMouseDown`。
  - 新增 `onAfterModelSelect?: () => void`，手动选中模型并关闭菜单后通知调用方恢复焦点。
- `src/components/chat/MessageInput.tsx`
  - 新增 `restoreComposerFocus()`，在模型选择完成后通过 `requestAnimationFrame`、`setTimeout(0)` 和 `setTimeout(50)` 多阶段恢复 `textarea[name="message"]` 焦点，覆盖 React 状态更新和 Electron click/blur 顺序差异。

## 防回归

- `src/__tests__/unit/provider-model-roundtrip.test.ts`
  - 增加静态回归测试，要求模型行阻止 mousedown 抢焦点。
  - 要求 `ModelSelectorDropdown` 通过 `onAfterModelSelect` 回调触发 `MessageInput` 的 `restoreComposerFocus`。

## 验证

- `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/provider-model-roundtrip.test.ts`：23 tests passed。
- `npm run typecheck`：passed。
- Playwright 轻量交互验证：
  - 打开 `http://127.0.0.1:3001/chat`。
  - 等待模型按钮从 `Loading models...` 变为可用。
  - 点击模型选择器并选择另一个模型。
  - 验证 `document.activeElement` 为 `TEXTAREA name="message"`。
  - 直接键入 `x`，textarea value 成功变为 `x`。
