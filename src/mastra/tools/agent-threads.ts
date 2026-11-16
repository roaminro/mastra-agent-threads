import { createHash } from 'node:crypto';
import type { Agent, MastraDBMessage } from '@mastra/core/agent';
import { MASTRA_RESOURCE_ID_KEY, RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import type { ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import { agentStatus, updateMetadata } from '../runs';
import type { RunMetadata } from '../runs';
import { DEFAULT_SANDBOX_ID, SANDBOX_ID_KEY } from '../workspaces/sandboxes';

/** Request context key that tells a child thread which thread started it. */
export const PARENT_THREAD_ID_KEY = 'parentThreadId';

const MAX_DEPTH = 2;
const MAX_CHILDREN = 5;
const MAX_SANDBOXES_PER_USER = 5;
const MAX_RUNNING_PER_USER = 10;

export type ThreadMetadata = RunMetadata & {
  sandboxId?: string;
  parentThreadId?: string;
  depth?: number;
  closed?: boolean;
};

/** A uuid-shaped id derived from the parent thread and the idempotency key, so a retry finds the same child. */
function idempotentId(resourceId: string, parentThreadId: string, key: string) {
  const hex = createHash('sha256').update(`${resourceId}\0${parentThreadId}\0${key}`).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/**
 * Run options for a thread woken by a signal. Every run of a thread needs to
 * know its sandbox and parent, and a woken run only sees what the sender passes.
 */
function runOptionsFor(thread: { resourceId: string; metadata?: Record<string, unknown> | null }) {
  const metadata = (thread.metadata ?? {}) as ThreadMetadata;
  const requestContext = new RequestContext();
  // The owning user, as the server would set it for a signed-in request. The
  // workspace is resolved from it, so the thread can only reach that user's sandboxes.
  requestContext.set(MASTRA_RESOURCE_ID_KEY, thread.resourceId);
  requestContext.set(SANDBOX_ID_KEY, metadata.sandboxId ?? DEFAULT_SANDBOX_ID);
  if (metadata.parentThreadId) requestContext.set(PARENT_THREAD_ID_KEY, metadata.parentThreadId);
  return { streamOptions: { requestContext } };
}

/** The calling thread, plus the agent and memory every tool below works through. */
async function caller(context: ToolExecutionContext) {
  const { mastra, agent: run } = context;
  if (!mastra || !run?.threadId || !run.resourceId) {
    throw new Error('Agent thread tools must run inside an agent call with memory (threadId and resourceId).');
  }
  const agent = mastra.getAgentById(run.agentId) as Agent;
  const memory = await agent.getMemory();
  if (!memory) throw new Error(`Agent ${run.agentId} has no memory, so it can't track threads.`);

  const thread = await memory.getThreadById({ threadId: run.threadId });
  const metadata = (thread?.metadata ?? {}) as ThreadMetadata;
  const sandboxId =
    (context.requestContext?.get(SANDBOX_ID_KEY) as string | undefined) ?? metadata.sandboxId ?? DEFAULT_SANDBOX_ID;

  return { agent, memory, threadId: run.threadId, resourceId: run.resourceId, metadata, sandboxId };
}

/** A thread the caller started. */
async function child(self: Awaited<ReturnType<typeof caller>>, threadId: string) {
  const thread = await peer(self, threadId);
  if ((thread.metadata as ThreadMetadata | undefined)?.parentThreadId !== self.threadId) {
    throw new Error(`${threadId} is not an agent you started.`);
  }
  return thread;
}

/** A thread the caller may talk to: any thread of the same user. */
async function peer(self: Awaited<ReturnType<typeof caller>>, threadId: string) {
  const thread = await self.memory.getThreadById({ threadId });
  if (!thread || thread.resourceId !== self.resourceId) throw new Error(`No agent thread ${threadId}.`);
  return thread;
}

export const startAgent = createTool({
  id: 'start_agent',
  description:
    'Start another agent on a separate task. Returns immediately with its thread id; the agent reports back with report_to_parent when it finishes. Calling it again with the same idempotencyKey returns the agent already started instead of a second one.',
  inputSchema: z.object({
    title: z.string().min(1).max(80).describe('Short name for the task, shown in the thread list'),
    task: z.string().min(1).describe('Complete instructions. The new agent sees nothing else from this conversation.'),
    sandbox: z
      .union([z.enum(['shared', 'new']), z.string().regex(/^sb-[\w-]+$/)])
      .describe(
        '"shared": your sandbox, including uncommitted files; give agents separate files to work on. "new": a fresh sandbox from the template. A sandbox id (sb-...): an existing sandbox from list_agents.',
      ),
    idempotencyKey: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('A name for this task that stays the same if you retry, e.g. "fix-login-tests"'),
  }),
  outputSchema: z.object({ threadId: z.string(), sandboxId: z.string(), alreadyStarted: z.boolean() }),
  execute: async ({ title, task, sandbox, idempotencyKey }, context) => {
    const self = await caller(context);
    return startThread(self, { parent: self, title, task, sandbox, idempotencyKey });
  },
});

type ThreadOwner = { agent: Agent; memory: NonNullable<Awaited<ReturnType<Agent['getMemory']>>>; resourceId: string };

/**
 * Creates a thread for a task and starts it. Used by `start_agent` (with the
 * calling thread as parent) and by the app's "new task" route (no parent).
 */
export async function startThread(
  owner: ThreadOwner,
  options: {
    parent?: { threadId: string; metadata: ThreadMetadata; sandboxId: string };
    title: string;
    task: string;
    /** "shared" means the parent's sandbox, or `main` for a top-level task. */
    sandbox: string;
    idempotencyKey?: string;
  },
) {
  const { parent, title, task, sandbox, idempotencyKey } = options;
  const { agent, memory, resourceId } = owner;
  const id = idempotencyKey ? idempotentId(resourceId, parent?.threadId ?? '', idempotencyKey) : crypto.randomUUID();
  const threadId = `agent-${id}`;
  const existing = await memory.getThreadById({ threadId });
  if (existing) {
    if (existing.resourceId !== resourceId) throw new Error(`No agent thread ${threadId}.`);
    const sandboxId = (existing.metadata as ThreadMetadata | undefined)?.sandboxId ?? DEFAULT_SANDBOX_ID;
    return { threadId, sandboxId, alreadyStarted: true };
  }

  const depth = parent ? (parent.metadata.depth ?? 0) + 1 : 0;
  if (depth > MAX_DEPTH) throw new Error(`Agents can only be nested ${MAX_DEPTH} levels deep. Do this task yourself.`);

  if (parent) {
    const { total } = await memory.listThreads({
      filter: { resourceId, metadata: { parentThreadId: parent.threadId } },
      perPage: 1,
    });
    if (total >= MAX_CHILDREN) throw new Error(`This thread already started ${MAX_CHILDREN} agents.`);
  }

  // Counts runs on this server process only; see the README for several instances.
  const running = agent.listActiveThreadRuns().filter(run => run.resourceId === resourceId).length;
  if (running >= MAX_RUNNING_PER_USER) {
    throw new Error(`${running} agents are already running for this user. Wait for some to finish.`);
  }

  const { threads } = await memory.listThreads({ filter: { resourceId }, perPage: false });
  const userSandboxes = new Set(threads.flatMap(t => ((t.metadata as ThreadMetadata | undefined)?.sandboxId ?? [])));

  let sandboxId: string;
  if (sandbox === 'shared') sandboxId = parent?.sandboxId ?? DEFAULT_SANDBOX_ID;
  else if (sandbox === 'new') {
    userSandboxes.delete(DEFAULT_SANDBOX_ID);
    if (userSandboxes.size >= MAX_SANDBOXES_PER_USER) {
      throw new Error(`This user already has ${MAX_SANDBOXES_PER_USER} extra sandboxes. Reuse one by id.`);
    }
    sandboxId = `sb-${id}`;
  } else {
    if (sandbox !== DEFAULT_SANDBOX_ID && !userSandboxes.has(sandbox)) throw new Error(`No sandbox ${sandbox}.`);
    sandboxId = sandbox;
  }

  const metadata: ThreadMetadata = { sandboxId, depth, ...(parent && { parentThreadId: parent.threadId }) };
  await memory.createThread({ threadId, resourceId, title, metadata });

  const result = agent.sendMessage(task, {
    resourceId,
    threadId,
    ifIdle: runOptionsFor({ resourceId, metadata }),
  });
  await result.accepted;
  return { threadId, sandboxId, alreadyStarted: false };
}

export const messageAgent = createTool({
  id: 'message_agent',
  description:
    "Send a message to another agent's thread (a child, your parent, or a sibling). It reaches the agent mid-task, or wakes it if it's idle.",
  inputSchema: z.object({
    threadId: z.string(),
    message: z.string().min(1),
  }),
  outputSchema: z.object({ delivered: z.boolean() }),
  execute: async ({ threadId, message }, context) => {
    const self = await caller(context);
    if (threadId === self.threadId) throw new Error("That's your own thread.");
    const target = await peer(self, threadId);
    // New instructions from its parent make a child's last report stale, so
    // wait_agent doesn't hand back the old one as the answer to the new task.
    if ((target.metadata as ThreadMetadata | undefined)?.parentThreadId === self.threadId) {
      await updateMetadata(self.memory, threadId, { report: null });
    }

    const result = self.agent.sendSignal(
      { type: 'reactive', tagName: 'agent-message', contents: message, attributes: { from: self.threadId } },
      { resourceId: self.resourceId, threadId, ifIdle: runOptionsFor(target) },
    );
    const accepted = await result.accepted;
    return { delivered: accepted.action === 'wake' || accepted.action === 'deliver' };
  },
});

export const interruptAgent = createTool({
  id: 'interrupt_agent',
  description:
    'Stop an agent you started, mid-task, and drop messages it has not read yet. Its thread and sandbox stay; use message_agent to give it new instructions.',
  inputSchema: z.object({ threadId: z.string() }),
  outputSchema: z.object({ stopped: z.boolean() }),
  execute: async ({ threadId }, context) => {
    const self = await caller(context);
    await child(self, threadId);
    // Also asks another server instance to stop the run if that instance owns it.
    const stopped = self.agent.abortThreadStream({ resourceId: self.resourceId, threadId, clearPendingSignals: true });
    return { stopped };
  },
});

export const reportToParent = createTool({
  id: 'report_to_parent',
  description: 'Send your result to the agent that started you. Call it once, when your task is done or blocked.',
  inputSchema: z.object({
    status: z.enum(['done', 'blocked']),
    summary: z.string().min(1).describe('What you did, what changed and where, and anything left open'),
  }),
  outputSchema: z.object({ delivered: z.boolean() }),
  execute: async ({ status, summary }, context) => {
    const self = await caller(context);
    if (!self.metadata.parentThreadId) throw new Error('This thread was not started by another agent.');
    const parent = await peer(self, self.metadata.parentThreadId);

    // Saved on this thread first, so the parent can still read it with
    // wait_agent if the signal is lost (for example, the server restarts).
    await updateMetadata(self.memory, self.threadId, { report: { status, summary, at: new Date().toISOString() } });

    const result = self.agent.sendSignal(
      { type: 'notification', tagName: 'agent-report', contents: summary, attributes: { from: self.threadId, status } },
      { resourceId: self.resourceId, threadId: parent.id, ifIdle: runOptionsFor(parent) },
    );
    const accepted = await result.accepted;
    return { delivered: accepted.action === 'wake' || accepted.action === 'deliver' };
  },
});

const WAIT_POLL_MS = 2_000;

export const waitAgent = createTool({
  id: 'wait_agent',
  description:
    "Check on an agent you started and get its report. Waits up to timeoutSeconds while it's running. Use it when a report you expected hasn't arrived, or after a server restart. Status 'interrupted' means a server restart cut its run off; send it message_agent to continue.",
  inputSchema: z.object({
    threadId: z.string(),
    timeoutSeconds: z.number().int().min(0).max(300).default(0),
  }),
  outputSchema: z.object({
    status: z.enum(['running', 'interrupted', 'idle']),
    report: z.object({ status: z.enum(['done', 'blocked']), summary: z.string(), at: z.string() }).nullable(),
  }),
  execute: async ({ threadId, timeoutSeconds }, context) => {
    const self = await caller(context);
    const deadline = Date.now() + timeoutSeconds * 1_000;
    let thread = await child(self, threadId);
    while (agentStatus(self.agent, thread) === 'running' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, WAIT_POLL_MS));
      thread = await child(self, threadId);
    }
    return {
      status: agentStatus(self.agent, thread),
      report: (thread.metadata as ThreadMetadata | undefined)?.report ?? null,
    };
  },
});

export const listAgents = createTool({
  id: 'list_agents',
  description: 'List the agents you started, with their sandbox and whether they are still running.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    agents: z.array(
      z.object({
        threadId: z.string(),
        title: z.string(),
        sandboxId: z.string(),
        status: z.enum(['running', 'interrupted', 'idle']),
        reported: z.enum(['done', 'blocked']).nullable(),
      }),
    ),
  }),
  execute: async (_input, context) => {
    const self = await caller(context);
    const { threads } = await self.memory.listThreads({
      filter: { resourceId: self.resourceId, metadata: { parentThreadId: self.threadId } },
      perPage: false,
    });
    return {
      agents: threads.map(thread => ({
        threadId: thread.id,
        title: thread.title ?? '',
        sandboxId: (thread.metadata as ThreadMetadata | undefined)?.sandboxId ?? DEFAULT_SANDBOX_ID,
        status: agentStatus(self.agent, thread),
        reported: (thread.metadata as ThreadMetadata | undefined)?.report?.status ?? null,
      })),
    };
  },
});

async function recentMessages(
  memory: ThreadOwner['memory'],
  threadId: string,
  resourceId: string,
  limit: number,
): Promise<MastraDBMessage[]> {
  // recall returns the newest page in chronological order.
  const { messages } = await memory.recall({
    threadId,
    resourceId,
    perPage: limit,
    orderBy: { field: 'createdAt', direction: 'DESC' },
  });
  return messages;
}

export const readAgent = createTool({
  id: 'read_agent',
  description: "Read the latest messages in another agent's thread, to check progress without interrupting it.",
  inputSchema: z.object({
    threadId: z.string(),
    limit: z.number().int().min(1).max(20).default(6),
  }),
  outputSchema: z.object({
    messages: z.array(z.object({ role: z.string(), text: z.string() })),
  }),
  execute: async ({ threadId, limit }, context) => {
    const self = await caller(context);
    await peer(self, threadId);
    const messages = await recentMessages(self.memory, threadId, self.resourceId, limit);
    return {
      messages: messages
        .map(message => ({
          role: message.role,
          text: message.content.parts
            .flatMap(part => (part.type === 'text' ? [part.text] : []))
            .join('\n'),
        }))
        .filter(message => message.text),
    };
  },
});

export const agentThreadTools = {
  start_agent: startAgent,
  message_agent: messageAgent,
  interrupt_agent: interruptAgent,
  report_to_parent: reportToParent,
  wait_agent: waitAgent,
  list_agents: listAgents,
  read_agent: readAgent,
};
