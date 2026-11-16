import { useEffect, useRef, useState } from 'react';
import { MastraReactProvider } from '@mastra/react';
import { LogOutIcon, PlusIcon } from 'lucide-react';
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
  const thread = threads.find(t => t.id === selected);
  const flagged = threads.filter(t => needsAttention(t, threads)).length;
  useMarkOpenTaskSeen(thread, threads);

  useEffect(() => {
    document.title = flagged ? `(${flagged}) Agent threads` : 'Agent threads';
  }, [flagged]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-11 items-center gap-3 border-b bg-rail px-3">
        <Logo />
        {flagged > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-xs text-foreground">
            <span className="size-1.5 rounded-full bg-foreground" />
            {flagged} to look at
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" onClick={() => setNewTaskOpen(true)}>
          <PlusIcon /> New task
        </Button>
        <span className="font-mono text-xs text-faint">{resourceId}</span>
        <Button size="icon-sm" variant="ghost" onClick={onSignOut} title="Sign out" className="text-faint">
          <LogOutIcon />
        </Button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[264px_1fr_340px]">
        <AgentTree threads={threads} selected={selected} onSelect={select} />
        {thread ? (
          <ThreadView key={thread.id} thread={thread} threads={threads} resourceId={resourceId} onSelect={select} />
        ) : (
          <div className="flex flex-col items-start justify-center gap-3 px-12">
            <p className="font-mono text-xs text-faint">no agent selected</p>
            <p className="max-w-sm text-muted-foreground">
              Pick an agent on the left, or give a new one a task. It can split the work across other agents.
            </p>
            <Button size="sm" variant="outline" onClick={() => setNewTaskOpen(true)}>
              <PlusIcon /> New task
            </Button>
          </div>
        )}
        {thread ? <FilesPanel key={`files-${thread.id}`} thread={thread} threads={threads} /> : <aside className="border-l bg-rail" />}
      </main>

      <NewTaskDialog threads={threads} open={newTaskOpen} onOpenChange={setNewTaskOpen} onStarted={select} />
    </div>
  );
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
