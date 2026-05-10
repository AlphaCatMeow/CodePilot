import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAllSessions, createSession } from '@/lib/db';
import type { CreateSessionRequest, SessionsResponse, SessionResponse } from '@/types';

export async function GET(request: NextRequest) {
  try {
    // Phase 3 Step 4 — task-bound sessions (`source='task'`) are the
    // execution sessions created by the agent task runner; they
    // shouldn't pollute the main ChatListPanel. The `source` query
    // param controls visibility:
    //   - omitted / 'user' → only user-created sessions (the default
    //     for ChatListPanel and most consumers).
    //   - 'task' → only task-bound sessions (used by Tasks page when
    //     listing all execution sessions).
    //   - 'all' → both (no filter).
    // This keeps the original "main list shows user conversations"
    // contract while still letting the Tasks page surface execution
    // sessions for users who want to browse them directly.
    const sourceParam = request.nextUrl.searchParams.get('source');
    const includeSources: ReadonlyArray<'user' | 'task'> | undefined =
      sourceParam === 'task'
        ? ['task']
        : sourceParam === 'all'
          ? undefined
          : ['user'];
    const sessions = getAllSessions(includeSources ? { includeSources } : undefined);
    const response: SessionsResponse = { sessions };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSessionRequest = await request.json();

    // Validate working_directory is provided
    if (!body.working_directory) {
      return Response.json(
        { error: 'Working directory is required', code: 'MISSING_DIRECTORY' },
        { status: 400 },
      );
    }

    // Validate directory actually exists on disk
    try {
      await fs.access(body.working_directory);
    } catch {
      return Response.json(
        { error: 'Directory does not exist', code: 'INVALID_DIRECTORY' },
        { status: 400 },
      );
    }

    const session = createSession(
      body.title,
      body.model,
      body.system_prompt,
      body.working_directory,
      body.mode,
      body.provider_id,
      body.permission_profile,
    );
    const response: SessionResponse = { session };
    return Response.json(response, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
