import type { MastraDBMessage } from '@mastra/react';
import { ArrowUpRightIcon } from 'lucide-react';
import { short } from '@/components/delete-thread-dialog';
import { Markdown } from '@/components/markdown';
import { CodeBlock, CodeBlockContent } from '@/components/ui/code-block';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import type { AgentThread } from '@/lib/api';
import { cn } from '@/lib/utils';

type Part = MastraDBMessage['content']['parts'][number];
type ToolInvocation = Extract<Part, { type: 'tool-invocation' }>['toolInvocation'];

type Signal = { tagName: string; contents: string; from?: string; status?: string };

// Messages between agents are signals (see `message_agent` and
// `report_to_parent` in the tools). Stored history keeps them as `signal`
// messages with the details in `metadata.signal`; while a run streams they
// arrive as `data-signal` parts.
type SignalData = { tagName?: string; attributes?: Record<string, string> };

function storedSignal(message: MastraDBMessage): Signal | undefined {
  const data = (message.content.metadata as { signal?: SignalData } | undefined)?.signal;
  if (data?.tagName !== 'agent-report' && data?.tagName !== 'agent-message') return undefined;
  return { tagName: data.tagName, contents: textOf(message), from: data.attributes?.from, status: data.attributes?.status };
}

function liveSignal(part: Part): Signal | undefined {
  if (part.type !== 'data-signal') return undefined;
  const data = (part as { data?: SignalData & { contents?: unknown } }).data;
  if (data?.tagName !== 'agent-report' && data?.tagName !== 'agent-message') return undefined;
  return {
    tagName: data.tagName,
    contents: typeof data.contents === 'string' ? data.contents : JSON.stringify(data.contents),
    from: data.attributes?.from,
    status: data.attributes?.status,
  };
}

const textOf = (message: MastraDBMessage) =>
  message.content.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n');

type Props = {
  message: MastraDBMessage;
  thread: AgentThread;
  threads: AgentThread[];
  /** Whether the thread has a run going, so a tool call without a result is still in progress. */
  running: boolean;
  isFirstUserMessage: boolean;
  onSelect: (id: string) => void;
};

export function ChatMessage({ message, thread, threads, running, isFirstUserMessage, onSelect }: Props) {
  const titleOf = (id?: string) => threads.find(t => t.id === id)?.title ?? 'a deleted agent';

  const renderSignal = (signal: Signal, key?: number) =>
    signal.tagName === 'agent-report' ? (
      <ReportCard key={key} signal={signal} title={titleOf(signal.from)} onSelect={onSelect} />
    ) : (
      <Incoming key={key} text={signal.contents} from={signal.from} title={titleOf(signal.from)} onSelect={onSelect} />
    );

  if (message.role === 'user' || message.role === 'signal') {
    const text = textOf(message);
    const signal = storedSignal(message);
    if (signal) return renderSignal(signal);
    const from = isFirstUserMessage ? (thread.parentThreadId ?? undefined) : undefined;
    return <Incoming text={text} from={from} title={titleOf(from)} onSelect={onSelect} />;
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {message.content.parts.map((part, index) => {
        const signal = liveSignal(part);
        if (signal) return renderSignal(signal, index);
        if (part.type === 'text' && part.text.trim()) {
          return (
            <Markdown key={index}>{part.text}</Markdown>
          );
        }
        if (part.type === 'tool-invocation') {
          return <ToolCall key={index} call={part.toolInvocation} running={running} threads={threads} onSelect={onSelect} />;
        }
        return null;
      })}
    </div>
  );
}

function ReportCard({ signal, title, onSelect }: { signal: Signal; title: string; onSelect: (id: string) => void }) {
  const blocked = signal.status === 'blocked';
  return (
    <div className="rounded-lg border px-4 py-3 text-sm">
      <div className="mb-1.5 text-xs text-faint">
        <button className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => signal.from && onSelect(signal.from)}>
          {title}
        </button>{' '}
        {blocked ? <span className="text-amber-400">is blocked</span> : 'finished'}
      </div>
      <Markdown>{signal.contents}</Markdown>
    </div>
  );
}

function Incoming({
  text,
  from,
  title,
  onSelect,
}: {
  text: string;
  from?: string;
  title: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
      {from && (
        <button className="text-xs text-faint hover:text-foreground hover:underline" onClick={() => onSelect(from)}>
          From {title}
        </button>
      )}
      <div className="rounded-2xl bg-raised px-4 py-2.5 text-sm">
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
}

const pretty = (value: unknown) => {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
};

const parse = (value: unknown) => {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
};

function ToolCall({
  call,
  running,
  threads,
  onSelect,
}: {
  call: ToolInvocation;
  running: boolean;
  threads: AgentThread[];
  onSelect: (id: string) => void;
}) {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const done = call.state === 'result';
  const result = done ? (call as { result: unknown }).result : undefined;

  // Starting an agent gets its own line with a link to the new thread.
  if (call.toolName === 'start_agent') {
    const started = parse(result) as { threadId?: string; sandboxId?: string } | undefined;
    const sandbox = args.sandbox === 'shared' ? 'the same sandbox' : args.sandbox === 'new' ? 'a new sandbox' : `sandbox ${short(String(args.sandbox))}`;
    const open = started?.threadId && threads.some(t => t.id === started.threadId);
    return (
      <button
        disabled={!open}
        onClick={() => open && onSelect(started.threadId!)}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 text-left text-sm text-faint enabled:hover:text-foreground"
      >
        <span>{done ? 'Started' : 'Starting'}</span>
        <span className="truncate text-muted-foreground group-enabled:group-hover:text-foreground">{String(args.title ?? 'an agent')}</span>
        <span>in {sandbox}</span>
        {open && <ArrowUpRightIcon className="size-3.5 opacity-0 group-hover:opacity-100" />}
      </button>
    );
  }

  const isCommand = call.toolName.endsWith('execute_command');
  const label = isCommand ? String(args.command ?? '') : call.toolName.replace(/^mastra_workspace_/, '');
  const failed = typeof result === 'string' && /^(error|failed)/i.test(result);
  // No result and nothing running: the run was cut off (stopped, or a server restart).
  const cutOff = !done && !running;

  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={cutOff ? 'error' : !done ? 'running' : failed ? 'error' : undefined}>
            <TraceTitle className={cn('max-w-[64ch] truncate font-mono text-xs text-faint', (cutOff || failed) && 'text-destructive')}>
              {isCommand && '$ '}
              {cutOff && "didn't finish: "}
              {label.split('\n')[0]}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <CodeBlock size="sm">
            <CodeBlockContent wrap>{isCommand ? label : pretty(args)}</CodeBlockContent>
          </CodeBlock>
          {done && (
            <CodeBlock size="sm" variant={failed ? 'destructive' : 'default'}>
              <CodeBlockContent wrap className="max-h-72">
                {pretty(result) || '(no output)'}
              </CodeBlockContent>
            </CodeBlock>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
