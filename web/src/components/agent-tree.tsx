import { useState } from 'react';
import { XIcon } from 'lucide-react';
import { DeleteThreadDialog, short } from '@/components/delete-thread-dialog';
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
        'size-1.5 shrink-0 rounded-full',
        thread.running
          ? 'animate-pulse bg-signal shadow-[0_0_8px] shadow-signal/60'
          : thread.status === 'interrupted'
            ? 'bg-amber-400'
            : attention
              ? 'bg-foreground'
              : 'border border-faint',
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
    const parent = threads.find(t => t.id === thread.parentThreadId);
    // Only call out a sandbox when it differs from the one the parent works in.
    const ownSandbox = parent ? parent.sandboxId !== thread.sandboxId : thread.sandboxId !== 'main';
    return (
      <li key={thread.id}>
        <div
          onClick={() => onSelect(thread.id)}
          className={cn(
            'group relative flex h-7 cursor-pointer items-center gap-2 rounded px-2 text-[13px] text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            thread.id === selected && 'bg-muted text-foreground',
            attention && 'font-medium text-foreground',
          )}
        >
          <StatusDot thread={thread} attention={attention} />
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          {ownSandbox && <span className="font-mono text-[11px] text-faint group-hover:hidden">{short(thread.sandboxId)}</span>}
          <button
            title="Delete"
            onClick={event => {
              event.stopPropagation();
              setDeleting(thread);
            }}
            className="hidden text-faint group-hover:block hover:text-destructive"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        {children.length > 0 && <ul className="ml-[11px] border-l pl-2">{children.map(node)}</ul>}
      </li>
    );
  };

  const running = threads.filter(t => t.running).length;
  const interrupted = threads.filter(t => t.status === 'interrupted').length;

  return (
    <aside className="flex min-h-0 flex-col border-r bg-rail">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Section title="tasks">
          {open.length ? (
            <ul>{open.map(node)}</ul>
          ) : (
            <p className="px-2 text-[13px] text-faint">Nothing open.</p>
          )}
        </Section>
        {closed.length > 0 && (
          <Section title="closed">
            <ul className="opacity-60">{closed.map(node)}</ul>
          </Section>
        )}
        <Section title="sandboxes">
          <ul>
            {sandboxes.map(s => (
              <li key={s} className="flex h-6 items-center justify-between px-2 font-mono text-xs">
                <span className="text-muted-foreground">{short(s)}</span>
                <span className="text-faint">{used.get(s) ?? 0}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <div className="flex flex-col gap-2 border-t p-3 font-mono text-[11px] text-faint">
        <Meter label="sandboxes" value={sandboxes.length} max={MAX_SANDBOXES} />
        <Meter label="running" value={running} max={MAX_RUNNING} active={running > 0} />
        {interrupted > 0 && <span className="text-amber-400">{interrupted} interrupted by a restart</span>}
      </div>

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

function Meter({ label, value, max, active }: { label: string; value: number; max: number; active?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16">{label}</span>
      <span className="flex flex-1 gap-0.5">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-[1px]', i < value ? (active ? 'bg-signal' : 'bg-muted-foreground') : 'bg-muted')} />
        ))}
      </span>
      <span className="w-8 text-right tabular-nums">
        {value}/{max}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="px-2 pb-1 font-mono text-[11px] text-faint">{title}</h3>
      {children}
    </section>
  );
}
