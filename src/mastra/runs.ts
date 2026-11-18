import type { Agent } from '@mastra/core/agent';
import type { Mastra } from '@mastra/core/mastra';
import { memory } from './memory';

// Agent runs live in the server's memory, so a crash or restart ends them and
// nothing resumes them. This records each running thread in its metadata,
// tagged with this server process, so after a restart the app can tell the
// user which agents were cut off.
//
// Mastra has no public event for "a thread run started/ended", so the tracker
// polls the agent's active runs. A run shorter than the interval may go
// unrecorded, which only matters if the server dies during it.

const BOOT_ID = crypto.randomUUID();
const POLL_MS = 2_000;

type Memory = typeof memory;
type Thread = { id: string; resourceId: string; title?: string; metadata?: Record<string, unknown> | null };

export type RunMetadata = {
  /** Set while a run is going; null when it ended. */
  run?: { boot: string; startedAt: string } | null;
  /** The child's last report_to_parent, saved before the parent is signalled; null once its parent gives it new instructions. */
  report?: { status: 'done' | 'blocked'; summary: string; at: string } | null;
  /** When the thread's last run ended. The app flags threads that finished after the user last opened them. */
  finishedAt?: string;
  /** When the user last opened the thread in the app. */
  seenAt?: string;
};

export type AgentStatus = 'running' | 'interrupted' | 'idle';

export function agentStatus(agent: Agent, thread: Thread): AgentStatus {
  if (agent.getActiveThreadRunId({ resourceId: thread.resourceId, threadId: thread.id })) return 'running';
  const run = (thread.metadata as RunMetadata | null | undefined)?.run;
  // A run recorded by an earlier server process never got to finish.
  return run && run.boot !== BOOT_ID ? 'interrupted' : 'idle';
}

/**
 * Sets some of a thread's metadata keys. Storage merges the patch into the
 * stored metadata, so only these keys change and concurrent writers to other
 * keys aren't overwritten. Clear a key by setting it to null.
 */
export async function updateMetadata(memory: Memory, threadId: string, patch: Partial<RunMetadata> & Record<string, unknown>) {
  const thread = await memory.getThreadById({ threadId });
  if (!thread) return;
  await memory.updateThread({ id: thread.id, title: thread.title ?? '', metadata: patch });
}

/** Records when each thread's run starts and ends, for every agent. */
export function trackRuns(mastra: Mastra) {
  let previous = new Map<string, string>();
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const runs = Object.values(mastra.listAgents()).flatMap(agent => (agent as Agent).listActiveThreadRuns());
      const current = new Map(runs.map(run => [run.threadId, run.runId]));

      for (const [threadId, runId] of current) {
        if (previous.get(threadId) === runId) continue;
        await updateMetadata(memory, threadId, { run: { boot: BOOT_ID, startedAt: new Date().toISOString() } });
      }
      for (const threadId of previous.keys()) {
        if (current.has(threadId)) continue;
        await updateMetadata(memory, threadId, { run: null, finishedAt: new Date().toISOString() });
      }
      previous = current;
    } catch (error) {
      console.error('Run tracker:', error);
    } finally {
      busy = false;
    }
  };

  setInterval(tick, POLL_MS).unref();
}
