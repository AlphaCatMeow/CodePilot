/**
 * builtin-tools/notification.ts — Notification tool handlers (shared between runtimes).
 *
 * These are the pure handler functions extracted from notification-mcp.ts.
 * Both SDK Runtime (via createSdkMcpServer) and Native Runtime (via AI SDK tool())
 * use these same handlers — single source of truth.
 */

import { tool } from 'ai';
import { z } from 'zod';

function getBaseUrl(): string {
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export const NOTIFICATION_SYSTEM_PROMPT = `## 通知与定时任务

你可以发送通知和创建定时任务：

- codepilot_notify: 立即发送通知给用户（支持系统通知和应用内提示）
- codepilot_schedule_task: 创建定时任务（支持 cron 表达式、固定间隔、一次性定时）
- codepilot_list_tasks: 查看已有的定时任务
- codepilot_cancel_task: 取消定时任务
- codepilot_hatch_buddy: 孵化或命名用户的助理伙伴

使用场景：
- 用户说"提醒我..."或"X 分钟后..." → 用 codepilot_schedule_task（schedule_type: "once"）
- 用户说"每天/每小时..." → 用 codepilot_schedule_task（schedule_type: "cron" 或 "interval"）
- 任务完成需要告知用户 → 用 codepilot_notify
- 用户问"有哪些定时任务" → 用 codepilot_list_tasks
- 用户说"孵化"、"领养"、"hatch" → 用 codepilot_hatch_buddy
- 用户给伙伴起名字 → 用 codepilot_hatch_buddy(buddyName: 名字)`;

/**
 * Phase 3 Step 4 follow-up — hidden run context for the schedule
 * tool. Mirrors `NotificationMcpContext` in notification-mcp.ts.
 * Native Runtime's tool factory closes over `{sessionId, workingDirectory}`
 * the same way the SDK MCP variant does so a model in chat session A
 * scheduling a task can't accidentally route the result to chat
 * session B (or to the buddy/heartbeat session).
 */
export interface NotificationToolsContext {
  sessionId?: string;
  workingDirectory?: string;
}

/**
 * Create notification tools as Vercel AI SDK ToolSet.
 * Can be used by both Native Runtime and as reference for SDK Runtime.
 */
export function createNotificationTools(ctx: NotificationToolsContext = {}) {
  return {
    codepilot_notify: tool({
      description: 'Send an immediate notification to the user.',
      inputSchema: z.object({
        title: z.string().describe('Notification title'),
        body: z.string().describe('Notification body text'),
        priority: z.enum(['low', 'normal', 'urgent']).optional().describe('low=toast, normal=toast+system, urgent=+telegram'),
      }),
      execute: async ({ title, body, priority }) => {
        try {
          const { sendNotification } = await import('@/lib/notification-manager');
          await sendNotification({ title, body, priority: priority || 'normal' });
          return `Notification sent: "${title}"`;
        } catch (err) {
          return `Failed to send notification: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

    codepilot_schedule_task: tool({
      description:
        'Create a scheduled task (cron / interval / once). Pick `kind` based on user intent:\n' +
        '  - "reminder" — natural-language reminders like "remind me to drink water in 5 minutes" / ' +
        '"提醒我 9 点开会". The scheduler will pop a notification with the prompt as the body and ' +
        'will NOT call any AI model. Use this whenever the user just wants to be reminded of ' +
        'something at a future time.\n' +
        '  - "ai_task" — workflows where the user wants an AI to actually run something on a schedule, ' +
        'e.g. "every morning summarize my unread emails", "every Monday review last week\'s commits". ' +
        'The scheduler feeds the prompt to the configured provider and surfaces the AI\'s reply.',
      inputSchema: z.object({
        name: z.string().describe('Task name'),
        prompt: z.string().describe(
          'For kind=reminder: the reminder body the user will see in the notification. ' +
          'For kind=ai_task: the instruction handed to the model.',
        ),
        // Phase 3 Step 3 — kind required so reminders bypass the AI
        // path. Server validates; if this is missing, /api/tasks/schedule
        // returns 400. DB default 'ai_task' is migration-only.
        kind: z.enum(['reminder', 'ai_task']).describe(
          "Task kind: 'reminder' (notification only, no AI call) or 'ai_task' (run prompt against configured provider)",
        ),
        schedule_type: z.enum(['cron', 'interval', 'once']),
        schedule_value: z.string().describe('cron: "0 9 * * *", interval: "30m", once: ISO timestamp'),
        priority: z.enum(['low', 'normal', 'urgent']).optional(),
        notify_on_complete: z.boolean().optional(),
        durable: z.boolean().optional().describe('true=persists across restart'),
      }),
      execute: async ({ name, prompt, kind, schedule_type, schedule_value, priority, notify_on_complete, durable }) => {
        try {
          // v6 fix (P2): if `durable=false`, take the session-only
          // branch — match `notification-mcp.ts` exactly so the AI
          // SDK builtin and the MCP variant behave the same way. The
          // previous code accepted the param then silently ignored
          // it, creating a persistent task; that broke the schema's
          // implicit promise.
          if (durable === false) {
            const cryptoMod = await import('crypto');
            const { addSessionTask, parseInterval, getNextCronTime } = await import('@/lib/task-scheduler');
            const id = cryptoMod.randomBytes(8).toString('hex');
            const now = new Date();
            let next_run: string;
            if (schedule_type === 'once') {
              next_run = schedule_value; // ISO timestamp
            } else if (schedule_type === 'interval') {
              next_run = new Date(now.getTime() + parseInterval(schedule_value)).toISOString();
            } else {
              const cronNext = getNextCronTime(schedule_value);
              if (!cronNext) {
                return `Cron expression "${schedule_value}" has no valid occurrence within 4 years. Task not created.`;
              }
              next_run = cronNext.toISOString();
            }
            // v4 fix #1 — session task literal MUST carry `kind`
            // explicitly. Bypassing /api/tasks/schedule means the
            // server-side kind validation doesn't run; the in-memory
            // dispatch in executeDueTask reads task.kind directly.
            const task = {
              id,
              name,
              prompt,
              kind,
              schedule_type,
              schedule_value,
              next_run,
              consecutive_errors: 0,
              status: 'active' as const,
              priority: priority || 'normal',
              notify_on_complete: notify_on_complete === false ? 0 : 1,
              permanent: 0,
              // Hidden run context (closure-captured) — same rationale
              // as the SDK MCP variant: the model's literal args don't
              // carry which project session this task belongs to.
              origin_session_id: ctx.sessionId,
              working_directory: ctx.workingDirectory,
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            };
            addSessionTask(task);
            return `Session task "${name}" scheduled (${kind}, non-durable). ID: ${id}, next run: ${next_run}`;
          }

          // v7 fix — POST body must carry `notify_on_complete` as 0/1,
          // never raw boolean. The /api/tasks/schedule route now also
          // normalizes defensively, but matching the MCP variant here
          // keeps the wire format consistent across both AI surfaces.
          // Maps false → 0, anything else (true/undefined) → 1.
          const notifyFlag: 0 | 1 = notify_on_complete === false ? 0 : 1;
          const baseUrl = getBaseUrl();
          const res = await fetch(`${baseUrl}/api/tasks/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              prompt,
              kind,
              schedule_type,
              schedule_value,
              priority,
              notify_on_complete: notifyFlag,
              durable,
              // Hidden run context — model can't override; closure
              // value wins. Empty when the tool was registered
              // without context (legacy callers / unit tests).
              origin_session_id: ctx.sessionId,
              working_directory: ctx.workingDirectory,
            }),
          });
          const data = await res.json();
          if (!res.ok) return `Failed to create task: ${data.error || res.statusText}`;
          return `Task "${name}" created (${kind}, ${schedule_type}: ${schedule_value})`;
        } catch (err) {
          return `Failed to create task: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

    codepilot_list_tasks: tool({
      description: 'List scheduled tasks.',
      inputSchema: z.object({
        status: z.enum(['active', 'paused', 'completed', 'disabled', 'all']).optional(),
      }),
      execute: async ({ status }) => {
        try {
          const baseUrl = getBaseUrl();
          const qs = status ? `?status=${status}` : '';
          const res = await fetch(`${baseUrl}/api/tasks/list${qs}`);
          const data = await res.json();
          if (!res.ok) return `Failed to list tasks: ${data.error || res.statusText}`;
          const tasks = data.tasks || [];
          if (tasks.length === 0) return 'No scheduled tasks found.';
          return tasks.map((t: { name: string; status: string; schedule_type: string; schedule_value: string }) =>
            `- ${t.name} (${t.status}) [${t.schedule_type}: ${t.schedule_value}]`
          ).join('\n');
        } catch (err) {
          return `Failed to list tasks: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),

    codepilot_cancel_task: tool({
      description: 'Cancel a scheduled task by ID.',
      inputSchema: z.object({
        task_id: z.string().describe('Task ID to cancel'),
      }),
      execute: async ({ task_id }) => {
        try {
          const baseUrl = getBaseUrl();
          const res = await fetch(`${baseUrl}/api/tasks/${task_id}`, { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return `Failed to cancel task: ${(data as { error?: string }).error || res.statusText}`;
          }
          return `Task ${task_id} cancelled.`;
        } catch (err) {
          return `Failed to cancel task: ${err instanceof Error ? err.message : 'unknown'}`;
        }
      },
    }),
  };
}
