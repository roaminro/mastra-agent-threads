import type { Agent } from '@mastra/core/agent';
import type { Mastra } from '@mastra/core/mastra';
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
type Context = Parameters<NonNullable<Parameters<typeof registerApiRoute>[1]['handler']>>[0];
import { z } from 'zod';
import { agentStatus, updateMetadata } from '../runs';
import { startThread } from '../tools/agent-threads';
import type { ThreadMetadata } from '../tools/agent-threads';
import { DEFAULT_SANDBOX_ID, deleteSandbox, listSandboxFiles, sandboxWorkspace } from '../workspaces/sandboxes';

// Routes for the web app. Mastra's built-in routes cover chatting with a
// thread; these cover what is specific to agent threads: the task tree, new
// tasks, close, delete, and sandbox files. Every route acts as the signed-in
// user and only touches that user's threads.

const MAX_FILE_BYTES = 200_000;

async function context(c: Context) {
  const resourceId = c.get('requestContext').get(MASTRA_RESOURCE_ID_KEY) as string | undefined;
  if (!resourceId) throw new HttpError(401, 'Sign in first.');
  const agent = (c.get('mastra') as Mastra).getAgentById('dev') as Agent;
  const memory = (await agent.getMemory())!;
  const { threads } = await memory.listThreads({ filter: { resourceId }, perPage: false });
  return { agent, memory, resourceId, threads };
}

type AppContext = Awaited<ReturnType<typeof context>>;

class HttpError extends Error {
  constructor(
    readonly status: 401 | 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

function route(path: string, method: 'GET' | 'POST' | 'DELETE', handler: (c: Context, app: AppContext) => Promise<unknown>) {
  return registerApiRoute(path, {
    method,
    handler: async c => {
      try {
        return c.json((await handler(c, await context(c))) ?? { ok: true });
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 400;
        return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
      }
    },
  });
}

const meta = (thread: { metadata?: Record<string, unknown> | null }) => (thread.metadata ?? {}) as ThreadMetadata;

function ownThread(app: AppContext, threadId: string) {
  const thread = app.threads.find(t => t.id === threadId);
  if (!thread) throw new HttpError(404, `No thread ${threadId}.`);
  return thread;
}

/** The thread and every agent below it. */
function subtree(app: AppContext, threadId: string): string[] {
  const children = app.threads.filter(t => meta(t).parentThreadId === threadId);
  return [threadId, ...children.flatMap(child => subtree(app, child.id))];
}

function stopAll(app: AppContext, threadIds: string[]) {
  for (const threadId of threadIds) {
    app.agent.abortThreadStream({ resourceId: app.resourceId, threadId, clearPendingSignals: true });
  }
}

/** A path inside the sandbox folder. Rejects anything that tries to leave it. */
function safePath(path: string | undefined) {
  const clean = (path ?? '').replace(/^\/+/, '');
  if (clean.split('/').some(part => part === '..')) throw new HttpError(400, 'Invalid path.');
  return clean || '.';
}

const newTask = z.object({
  title: z.string().min(1).max(80),
  task: z.string().min(1),
  sandbox: z.union([z.enum(['main', 'new']), z.string().regex(/^sb-[\w-]+$/)]),
});

export const appRoutes = [
  // Who the token belongs to. The app needs the resource id for chat calls.
  route('/app/me', 'GET', async (_c, app) => ({ resourceId: app.resourceId })),

  // Every thread of the user, with what the tree needs: parent, sandbox,
  // depth, closed, its status (running, interrupted, idle), and its last report.
  route('/app/threads', 'GET', async (_c, app) => ({
    threads: app.threads.map(thread => ({
      id: thread.id,
      title: thread.title ?? '',
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      parentThreadId: meta(thread).parentThreadId ?? null,
      sandboxId: meta(thread).sandboxId ?? DEFAULT_SANDBOX_ID,
      depth: meta(thread).depth ?? 0,
      closed: Boolean(meta(thread).closed),
      // "interrupted": a server restart cut its last run off.
      status: agentStatus(app.agent, thread),
      runStartedAt: meta(thread).run?.startedAt ?? null,
      report: meta(thread).report ?? null,
      finishedAt: meta(thread).finishedAt ?? null,
      seenAt: meta(thread).seenAt ?? null,
    })),
  })),

  route('/app/tasks', 'POST', async (c, app) => {
    const body = newTask.parse(await c.req.json());
    return startThread(app, { ...body, sandbox: body.sandbox === 'main' ? 'shared' : body.sandbox });
  }),

  // Close stops every agent in the task and marks the top-level thread closed.
  // Conversations and files stay; reopening clears the flag.
  route('/app/threads/:threadId/close', 'POST', async (c, app) => {
    const { closed } = z.object({ closed: z.boolean() }).parse(await c.req.json());
    const thread = ownThread(app, c.req.param('threadId')!);
    if (closed) stopAll(app, subtree(app, thread.id));
    await updateMetadata(app.memory, thread.id, { closed });
  }),

  // Records that the user opened the thread, which clears its "needs attention" flag.
  route('/app/threads/:threadId/seen', 'POST', async (c, app) => {
    const thread = ownThread(app, c.req.param('threadId')!);
    await updateMetadata(app.memory, thread.id, { seenAt: new Date().toISOString() });
  }),

  // Clears the "interrupted" state without resuming the agent.
  route('/app/threads/:threadId/dismiss', 'POST', async (c, app) => {
    const thread = ownThread(app, c.req.param('threadId')!);
    if (agentStatus(app.agent, thread) !== 'interrupted') return;
    await updateMetadata(app.memory, thread.id, { run: null });
  }),

  // Delete removes the thread and every agent below it, then deletes the
  // sandboxes no remaining thread uses. `main` is never deleted.
  route('/app/threads/:threadId', 'DELETE', async (c, app) => {
    const ids = subtree(app, ownThread(app, c.req.param('threadId')!).id);
    stopAll(app, ids);
    for (const id of ids) await app.memory.deleteThread(id);

    const remaining = app.threads.filter(t => !ids.includes(t.id));
    const used = new Set(remaining.map(t => meta(t).sandboxId ?? DEFAULT_SANDBOX_ID));
    const freed = [
      ...new Set(ids.map(id => meta(ownThread(app, id)).sandboxId ?? DEFAULT_SANDBOX_ID)),
    ].filter(sandboxId => sandboxId !== DEFAULT_SANDBOX_ID && !used.has(sandboxId));

    // Deleting files on Modal may have to start a machine first, so it runs
    // after the response.
    for (const sandboxId of freed) {
      deleteSandbox(app.resourceId, sandboxId).catch(error =>
        console.error(`Deleting sandbox ${sandboxId} failed:`, error),
      );
    }
    return { deleted: ids, freedSandboxes: freed };
  }),

  route('/app/threads/:threadId/files', 'GET', async (c, app) => {
    const thread = ownThread(app, c.req.param('threadId')!);
    const path = safePath(c.req.query('path'));
    const entries = await listSandboxFiles(app.resourceId, meta(thread).sandboxId ?? DEFAULT_SANDBOX_ID, path);
    return {
      path,
      entries: entries
        .filter(entry => entry.name !== '.git' && entry.name !== 'node_modules')
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)),
    };
  }),

  route('/app/threads/:threadId/file', 'GET', async (c, app) => {
    const thread = ownThread(app, c.req.param('threadId')!);
    const workspace = await sandboxWorkspace(app.resourceId, meta(thread).sandboxId ?? DEFAULT_SANDBOX_ID);
    const path = safePath(c.req.query('path'));
    const content = String(await workspace.filesystem!.readFile(path, { encoding: 'utf-8' }));
    return { path, content: content.slice(0, MAX_FILE_BYTES), truncated: content.length > MAX_FILE_BYTES };
  }),
];
