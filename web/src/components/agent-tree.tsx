import { useState } from 'react';
import { XIcon } from 'lucide-react';
import { DeleteThreadDialog, short } from '@/components/delete-thread-dialog';
import { Badge } from '@/components/ui/badge';
import { type AgentThread, childrenOf, needsAttention } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_SANDBOXES = 6; // main + 5, as in src/mastra/tools/agent-threads.ts
const MAX_RUNNING = 10;

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
          ? 'animate-pulse bg-emerald-400 shadow-[0_0_0_3px] shadow-emerald-400/20'
          : thread.status === 'interrupted'
            ? 'bg-amber-400'
            : attention
              ? 'bg-sky-400 shadow-[0_0_0_3px] shadow-sky-400/25'
              : 'bg-muted-foreground/60',
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

  const used = new Map<string, number>();
  for (const t of threads) used.set(t.sandboxId, (used.get(t.sandboxId) ?? 0) + 1);
  const sandboxes = ['main', ...[...used.keys()].filter(s => s !== 'main')];

  const node = (thread: AgentThread) => {
    const children = childrenOf(threads, thread.id);
    const attention = needsAttention(thread, threads);
    return (
      <li key={thread.id}>
        <div
          onClick={() => onSelect(thread.id)}
          className={cn(
            'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
            thread.id === selected && 'bg-muted ring-1 ring-sky-500/40',
          )}
        >
          <StatusDot thread={thread} attention={attention} />
          <span className={cn('min-w-0 flex-1 truncate', attention && 'font-semibold text-foreground')}>
            {thread.title}
          </span>
          <Badge variant="outline" className="font-mono text-[10px] text-violet-300">
            {short(thread.sandboxId)}
          </Badge>
          <button
            title="Delete"
            onClick={event => {
              event.stopPropagation();
              setDeleting(thread);
            }}
            className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        {children.length > 0 && <ul className="ml-3.5 border-l border-dashed pl-2">{children.map(node)}</ul>}
      </li>
    );
  };

  return (
    <aside className="min-h-0 overflow-y-auto border-r p-2">
      <Section title="Agents">
        {open.length ? (
          <ul>{open.map(node)}</ul>
        ) : (
          <p className="px-2 text-sm text-muted-foreground">No open tasks.</p>
        )}
      </Section>
      {closed.length > 0 && (
        <Section title="Closed">
          <ul className="opacity-70">{closed.map(node)}</ul>
        </Section>
      )}
      <Section title="Sandboxes">
        <ul>
          {sandboxes.map(s => (
            <li key={s} className="flex items-center gap-2 px-2 py-1 text-sm">
              <Badge variant="outline" className="font-mono text-[10px] text-violet-300">
                {short(s)}
              </Badge>
              <span className="text-muted-foreground">
                {used.get(s) ?? 0} agent{used.get(s) === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
        <p className="px-2 pt-2 text-xs text-muted-foreground">
          {sandboxes.length} of {MAX_SANDBOXES} sandboxes · {threads.filter(t => t.running).length} of {MAX_RUNNING}{' '}
          agents running
          {threads.some(t => t.status === 'interrupted') && (
            <span className="text-amber-400">
              {' '}
              · {threads.filter(t => t.status === 'interrupted').length} interrupted
            </span>
          )}
        </p>
      </Section>

      <DeleteThreadDialog
        thread={deleting}
        threads={threads}
        onOpenChange={open => !open && setDeleting(null)}
        onDeleted={deleted => {
          setDeleting(null);
          if (selected && deleted.includes(selected)) onSelect(null);
        }}
      />
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}
