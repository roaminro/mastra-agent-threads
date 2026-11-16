import type { MastraDBMessage } from '@mastra/react';
import { ArrowUpRightIcon, BotIcon, CircleAlertIcon, CircleCheckIcon, TerminalIcon, WrenchIcon } from 'lucide-react';
import { Markdown } from '@/components/markdown';
import { CodeBlock, CodeBlockContent } from '@/components/ui/code-block';
import { Message, MessageContent, MessageHeader } from '@/components/ui/message';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
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
    <div className="flex flex-col gap-2 text-sm">
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
    <div
      className={cn(
        'rounded-xl border p-3 text-sm',
        blocked ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/40 bg-emerald-500/10',
      )}
    >
      <div className={cn('mb-1 flex items-center gap-2 font-medium', blocked ? 'text-amber-300' : 'text-emerald-300')}>
        {blocked ? <CircleAlertIcon className="size-4" /> : <CircleCheckIcon className="size-4" />}
        Report from
        <button className="underline" onClick={() => signal.from && onSelect(signal.from)}>
          {title}
        </button>
        · {blocked ? 'blocked' : 'done'}
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
    <Message align="end">
      <div className="flex max-w-[85%] flex-col items-end gap-1">
        {from && (
          <MessageHeader>
            <button className="hover:underline" onClick={() => onSelect(from)}>
              from agent · {title}
            </button>
          </MessageHeader>
        )}
        <MessageContent className="rounded-xl bg-sky-950/60 px-3 py-2 ring-1 ring-sky-800/60">
          <Markdown>{text}</Markdown>
        </MessageContent>
      </div>
    </Message>
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
    const sandbox = args.sandbox === 'shared' ? 'this sandbox (shared)' : args.sandbox === 'new' ? 'a new sandbox' : String(args.sandbox);
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-sky-800 px-3 py-2 text-muted-foreground">
        <BotIcon className="size-4 text-sky-400" />
        <span>
          {done ? 'Started' : 'Starting'} <b className="text-foreground">{String(args.title ?? 'an agent')}</b> in {sandbox}
        </span>
        {started?.threadId && threads.some(t => t.id === started.threadId) && (
          <button className="ml-auto flex items-center gap-1 text-sky-400" onClick={() => onSelect(started.threadId!)}>
            open <ArrowUpRightIcon className="size-3.5" />
          </button>
        )}
      </div>
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
            <TraceIcon>{isCommand ? <TerminalIcon /> : <WrenchIcon />}</TraceIcon>
            <TraceTitle className="max-w-[60ch] truncate font-mono text-xs">
              {done ? (isCommand ? 'Ran ' : 'Called ') : cutOff ? "Didn't finish: " : 'Running '}
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
