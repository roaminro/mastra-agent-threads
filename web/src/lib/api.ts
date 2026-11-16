import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const TOKEN_KEY = 'agent-threads-token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) =>
  token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);

export type AgentThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  parentThreadId: string | null;
  sandboxId: string;
  depth: number;
  closed: boolean;
  /** "interrupted": a server restart cut its last run off. */
  status: 'running' | 'interrupted' | 'idle';
  runStartedAt: string | null;
  report: { status: 'done' | 'blocked'; summary: string; at: string } | null;
  /** When its last run ended, and when the user last opened it. */
  finishedAt: string | null;
  seenAt: string | null;
  running: boolean;
};

export type FileEntry = { name: string; type: 'file' | 'directory'; size?: number };

/** Calls one of the app routes in `src/mastra/routes/app.ts` as the signed-in user. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; token?: string }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${init?.token ?? getToken()}`,
      ...(init?.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
}

// The tree polls so it picks up agents that other agents start, and which
// ones are running.
export const useThreads = () =>
  useQuery({
    queryKey: ['threads'],
    queryFn: () =>
      api<{ threads: Omit<AgentThread, 'running'>[] }>('/app/threads').then(r =>
        r.threads.map(t => ({
          ...t,
          // Threads started outside this app (e.g. Studio) may have no title.
          title: t.title || 'Untitled conversation',
          running: t.status === 'running',
        })),
      ),
    refetchInterval: 3000,
  });

function useInvalidatingMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['threads'] }) });
}

export const useStartTask = () =>
  useInvalidatingMutation((body: { title: string; task: string; sandbox: string }) =>
    api<{ threadId: string; sandboxId: string }>('/app/tasks', { method: 'POST', body }),
  );

export const useCloseTask = () =>
  useInvalidatingMutation(({ threadId, closed }: { threadId: string; closed: boolean }) =>
    api(`/app/threads/${threadId}/close`, { method: 'POST', body: { closed } }),
  );

export const useDeleteThread = () =>
  useInvalidatingMutation((threadId: string) =>
    api<{ deleted: string[]; freedSandboxes: string[] }>(`/app/threads/${threadId}`, { method: 'DELETE' }),
  );

export const useFiles = (threadId: string, path: string) =>
  useQuery({
    queryKey: ['files', threadId, path],
    queryFn: () =>
      api<{ entries: FileEntry[] }>(`/app/threads/${threadId}/files?path=${encodeURIComponent(path)}`).then(
        r => r.entries,
      ),
    refetchInterval: 10_000,
  });

export const useFile = (threadId: string, path: string | null) =>
  useQuery({
    queryKey: ['file', threadId, path],
    queryFn: () =>
      api<{ content: string; truncated: boolean }>(
        `/app/threads/${threadId}/file?path=${encodeURIComponent(path!)}`,
      ),
    enabled: Boolean(path),
  });

/** Helpers for the thread tree. */
export const childrenOf = (threads: AgentThread[], id: string | null) =>
  threads
    .filter(t => t.parentThreadId === id)
    // Newest task first, a task's agents oldest first. Not by updatedAt: metadata
    // writes (run tracking, opening a task) bump it and would reorder the list.
    .sort((a, b) => (id ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));

export const subtreeOf = (threads: AgentThread[], id: string): AgentThread[] => [
  ...threads.filter(t => t.id === id),
  ...childrenOf(threads, id).flatMap(child => subtreeOf(threads, child.id)),
];

export const rootOf = (threads: AgentThread[], id: string): AgentThread | undefined => {
  const thread = threads.find(t => t.id === id);
  return thread?.parentThreadId ? rootOf(threads, thread.parentThreadId) : thread;
};

export const useDismissInterrupted = () =>
  useInvalidatingMutation(({ threadId }: { threadId: string }) =>
    api(`/app/threads/${threadId}/dismiss`, { method: 'POST' }),
  );

export const useMarkSeen = () =>
  useInvalidatingMutation((threadId: string) => api(`/app/threads/${threadId}/seen`, { method: 'POST' }));

/**
 * A task the user should look at: its agent finished a turn after the user last
 * opened it, and nothing in it is still working. Only top-level tasks are
 * flagged; a child's result goes to its parent, which finishes after it.
 */
export const needsAttention = (thread: AgentThread, threads: AgentThread[]) =>
  !thread.parentThreadId &&
  !thread.closed &&
  thread.status === 'idle' &&
  Boolean(thread.finishedAt) &&
  (!thread.seenAt || thread.finishedAt! > thread.seenAt) &&
  !subtreeOf(threads, thread.id).some(t => t.running);
