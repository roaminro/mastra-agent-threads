import { useState } from 'react';
import { XIcon } from 'lucide-react';
import { DeleteThreadDialog } from '@/components/delete-thread-dialog';
import { type AgentThread, childrenOf, needsAttention } from '@/lib/api';
import { cn } from '@/lib/utils';

export function StatusDot({ thread, attention }: { thread: AgentThread; attention?: boolean }) {
  return (
    <span
      title={
        thread.running
          ? 'Running'
          : thread.status === 'interrupted'
            ? 'Interrupted by a server restart'
            : attention
              ? 'Finished since you last looked'
              : 'Idle'
      }
      className={cn(
        'size-2 shrink-0 rounded-full',
        thread.running
          ? 'animate-pulse bg-signal'
          : thread.status === 'interrupted'
            ? 'bg-amber-400'
            : attention
              ? 'bg-sky-400'
              : 'bg-faint/40',
      )}
    />
  );
}

/** Tasks the user started, with the agents each one started nested underneath. */
export function AgentTree({
  threads,
  selected,
  onSelect,
}: {
  threads: AgentThread[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [deleting, setDeleting] = useState<AgentThread | null>(null);
  const roots = childrenOf(threads, null);
  const open = roots.filter(t => !t.closed);
  const closed = roots.filter(t => t.closed);

  const node = (thread: AgentThread) => {
    const children = childrenOf(threads, thread.id);
    const attention = needsAttention(thread, threads);
    return (
      <li key={thread.id}>
        <div
          onClick={() => onSelect(thread.id)}
          className={cn(
            'group flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            thread.id === selected && 'bg-muted text-foreground',
            attention && 'font-medium text-foreground',
          )}
        >
          <StatusDot thread={thread} attention={attention} />
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          <button
            title="Delete"
            onClick={event => {
              event.stopPropagation();
              setDeleting(thread);
            }}
            className="hidden text-faint group-hover:block hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        {children.length > 0 && <ul className="ml-[11px] pl-3">{children.map(node)}</ul>}
      </li>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      {open.length ? <ul>{open.map(node)}</ul> : <p className="px-2 text-sm text-faint">No tasks yet.</p>}
      {closed.length > 0 && (
        <>
          <h3 className="mt-6 mb-1 px-2 text-xs text-faint">Closed</h3>
          <ul className="opacity-60">{closed.map(node)}</ul>
        </>
      )}

      <DeleteThreadDialog
        thread={deleting}
        threads={threads}
        onOpenChange={open => !open && setDeleting(null)}
        onDeleted={deleted => {
          setDeleting(null);
          if (selected && deleted.includes(selected)) onSelect(null);
        }}
      />
    </div>
  );
}
