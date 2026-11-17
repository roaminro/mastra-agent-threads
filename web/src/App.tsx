import { useEffect, useRef, useState } from 'react';
import { MastraReactProvider } from '@mastra/react';
import { LogOutIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentTree } from '@/components/agent-tree';
import { Logo } from '@/components/logo';
import { FilesPanel } from '@/components/files-panel';
import { NewTaskDialog } from '@/components/new-task-dialog';
import { SignIn } from '@/components/sign-in';
import { ThreadView } from '@/components/thread-view';
import { Button } from '@/components/ui/button';
import { type AgentThread, api, getToken, needsAttention, rootOf, setToken, useMarkSeen, useThreads } from '@/lib/api';

type Session = { token: string; resourceId: string };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  // Restore the saved token if it still works.
  useEffect(() => {
    const token = getToken();
    if (!token) return setChecking(false);
    api<{ resourceId: string }>('/app/me', { token })
      .then(({ resourceId }) => setSession({ token, resourceId }))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (!session) return <SignIn onSignIn={(token, resourceId) => setSession({ token, resourceId })} />;

  return (
    <MastraReactProvider baseUrl={window.location.origin} headers={{ Authorization: `Bearer ${session.token}` }}>
      <Workspace
        resourceId={session.resourceId}
        onSignOut={() => {
          setToken(null);
          setSession(null);
        }}
      />
    </MastraReactProvider>
  );
}

/** The selected thread lives in the URL hash, so reloading keeps it. */
function useSelectedThread() {
  const [selected, setSelected] = useState(() => window.location.hash.slice(1) || null);
  useEffect(() => {
    const onHash = () => setSelected(window.location.hash.slice(1) || null);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const select = (id: string | null) => {
    window.location.hash = id ?? '';
    setSelected(id);
  };
  return [selected, select] as const;
}

function Workspace({ resourceId, onSignOut }: { resourceId: string; onSignOut: () => void }) {
  const { data: threads = [] } = useThreads();
  const [selected, select] = useSelectedThread();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useFilesOpen();
  const thread = threads.find(t => t.id === selected);
  const flagged = threads.filter(t => needsAttention(t, threads)).length;
  useMarkOpenTaskSeen(thread, threads);

  useEffect(() => {
    document.title = flagged ? `(${flagged}) Agent threads` : 'Agent threads';
  }, [flagged]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <main className={cn('grid min-h-0 flex-1', thread && filesOpen ? 'grid-cols-[240px_1fr_320px]' : 'grid-cols-[240px_1fr]')}>
        <aside className="flex min-h-0 flex-col border-r">
          <div className="flex h-12 items-center justify-between px-4">
            <Logo />
            <Button size="icon-sm" variant="ghost" onClick={onSignOut} title={`Sign out ${resourceId}`} className="text-faint">
              <LogOutIcon />
            </Button>
          </div>
          <div className="px-3 pb-2">
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setNewTaskOpen(true)}>
              <PlusIcon /> New task
            </Button>
          </div>
          <AgentTree threads={threads} selected={selected} onSelect={select} />
        </aside>
        {thread ? (
          <ThreadView
            key={thread.id}
            thread={thread}
            threads={threads}
            resourceId={resourceId}
            onSelect={select}
            filesOpen={filesOpen}
            onToggleFiles={() => setFilesOpen(!filesOpen)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              Give an agent a task. It can split the work across other agents.
            </p>
            <Button size="sm" onClick={() => setNewTaskOpen(true)}>
              <PlusIcon /> New task
            </Button>
          </div>
        )}
        {thread && filesOpen && <FilesPanel key={`files-${thread.id}`} thread={thread} />}
      </main>

      <NewTaskDialog threads={threads} open={newTaskOpen} onOpenChange={setNewTaskOpen} onStarted={select} />
    </div>
  );
}

/** The files panel stays open or closed across threads and reloads. */
function useFilesOpen() {
  const [open, setOpen] = useState(() => localStorage.getItem('agent-threads-files') === 'open');
  const set = (value: boolean) => {
    localStorage.setItem('agent-threads-files', value ? 'open' : 'closed');
    setOpen(value);
  };
  return [open, set] as const;
}

/**
 * Opening a task marks it seen. This also runs while the task is open, so one
 * that finishes in front of the user doesn't get flagged.
 */
function useMarkOpenTaskSeen(thread: AgentThread | undefined, threads: AgentThread[]) {
  const markSeen = useMarkSeen();
  const marked = useRef<string | null>(null);
  const root = thread && rootOf(threads, thread.id);
  const key = root && needsAttention(root, threads) ? `${root.id}:${root.finishedAt}` : null;
  useEffect(() => {
    if (!key || !root || marked.current === key) return;
    marked.current = key;
    markSeen.mutate(root.id);
  }, [key, root, markSeen]);
}
