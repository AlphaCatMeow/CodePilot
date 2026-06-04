/**
 * #34 — Mac 定时任务到点执行但不弹系统通知。
 *
 * 代码链是通的（scheduler → sendTaskNotification → sendNotification 入队 →
 * 窗口可见走 useNotificationPoll 的 in-app toast + OS 通知；窗口隐藏走 bg-poller
 * 的 OS 通知）。"无弹窗"几乎必为运行时条件——最可能 (a) dev Electron app 没拿到
 * macOS 通知权限（未签名 dev 二进制 → new Notification().show() 静默 no-op），或
 * (b) macOS 对 focused 应用抑制横幅（in-app toast 仍应出）。两者都需在运行的客户端
 * fire 一个任务 + 看日志才能确认。
 *
 * 本测试 source-pin 住"可观测性"：scheduler 不再静默吞 enqueue 失败、两条 show 路径
 * 都打 [notify] 日志（含 supported / focused 状态），让下次任务触发能一眼定位断点。
 * 真实端到端验收（fire 任务 + 看 Notification Center / System Settings）见
 * preview-build-readiness Phase 3 / #34。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('#34 notification dispatch observability (source-pin)', () => {
  it('scheduler logs [notify] on enqueue success AND on failure (no more silent swallow)', () => {
    const src = read('src/lib/task-scheduler.ts');
    assert.match(src, /\[notify\] enqueued/);
    assert.match(src, /\[notify\] enqueue FAILED/);
  });

  it('Electron both show paths log [notify] with supported / focused state', () => {
    const src = read('electron/main.ts');
    assert.match(src, /\[notify\] bg-poller OS notification/);
    assert.match(src, /\[notify\] notification:show renderer path/);
    assert.match(src, /Notification\.isSupported\(\)/);
    assert.match(src, /mainWindow\?\.isFocused\(\)/);
  });
});
