import { useMemo, useState } from 'react';
import { RequestContext } from '@mastra/core/request-context';
import { type MastraDBMessage, useMastraClient } from '@mastra/react';
import { useQuery } from '@tanstack/react-query';
import { useChat } from '@mastra/react/chat';
import { ArrowLeftIcon, ArrowUpIcon, FolderIcon, PlayIcon, SquareIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ChatMessage } from '@/components/chat-message';
import { DeleteThreadDialog, short } from '@/components/delete-thread-dialog';
import { Button } from '@/components/ui/button';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { type AgentThread, rootOf, useCloseTask, useDismissInterrupted } from '@/lib/api';

type ThreadViewProps = {
  thread: AgentThread;
  threads: AgentThread[];
  resourceId: string;
  onSelect: (id: string | null) => void;
  filesOpen: boolean;
  onToggleFiles: () => void;
};

export function ThreadView(props: ThreadViewProps) {
  const client = useMastraClient();
  const history = useQuery({
    queryKey: ['history', props.thread.id],
    queryFn: () =>
      client
        .getMemoryThread({ threadId: props.thread.id, agentId: 'dev' })
        .listMessages({ resourceId: props.resourceId, perPage: 200 })
        .then(r => r.messages)
        // A task opened right after it starts may not be saved yet.
        .catch(error => {
          if ((error as { status?: number }).status === 404) return [];
          throw error;
        }),
    staleTime: Infinity,
    gcTime: 0,
  });
  if (history.isPending) {
    return (
      <section className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading conversation…
      </section>
    );
  }
  if (history.isError) {
    return <section className="p-6 text-sm text-destructive">{history.error.message}</section>;
  }
  return <ThreadChat {...props} history={history.data} />;
}

function ThreadChat({
  thread,
  threads,
  resourceId,
  onSelect,
  filesOpen,
  onToggleFiles,
  history,
}: ThreadViewProps & { history: MastraDBMessage[] }) {
  const client = useMastraClient();
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState(false);
  const closeTask = useCloseTask();
  const dismiss = useDismissInterrupted();
  const root = rootOf(threads, thread.id) ?? thread;
  const parent = threads.find(t => t.id === thread.parentThreadId);

  // Runs started from here must run in the thread's own sandbox, as the tools
  // do when they wake a thread. The server only accepts a sandbox id that one
  // of this user's threads uses.
  const requestContext = useMemo(() => {
    const context = new RequestContext();
    context.set('sandboxId', thread.sandboxId);
    if (thread.parentThreadId) context.set('parentThreadId', thread.parentThreadId);
    return context;
  }, [thread.sandboxId, thread.parentThreadId]);

  // Thread signals: a message sent while the agent works reaches it mid-task,
  // and the subscription streams runs this page didn't start (reports from
  // children waking the parent, or a parent messaging this agent).
  const chat = useChat({
    agentId: 'dev',
    resourceId,
    threadId: thread.id,
    requestContext,
    initialMessages: history,
    enableThreadSignals: true,
  });
  const running = chat.isRunning || thread.running;
  const interrupted = !running && thread.status === 'interrupted';
  // Opening a thread while its first run is going loads the task message from
  // history and then gets the run's live echo of it under another id.
  const incoming = (message: MastraDBMessage) => message.role === 'user' || message.role === 'signal';
  const messages = useMemo(
    () =>
      chat.messages.filter((message, index) => {
        if (!incoming(message)) return true;
        const text = JSON.stringify(message.content.parts);
        const at = new Date(message.createdAt).getTime();
        return !chat.messages
          .slice(0, index)
          .some(
            earlier =>
              incoming(earlier) &&
              JSON.stringify(earlier.content.parts) === text &&
              Math.abs(new Date(earlier.createdAt).getTime() - at) < 5_000,
          );
      }),
    [chat.messages],
  );
  const firstUserId = messages.find(incoming)?.id;

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    setDraft('');
    void chat.sendMessage({ message, threadId: thread.id, requestContext });
  };

  const resume = () =>
    void chat.sendMessage({
      message:
        'The server restarted and cut off your last turn. Anything you had not saved is lost. Check the state of your files in /mnt/work, then continue where you left off.',
      threadId: thread.id,
      requestContext,
    });

  const stop = async () => {
    await client.getAgent('dev').abortThread({ resourceId, threadId: thread.id });
  };

  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        {parent && (
          <Button size="icon-sm" variant="ghost" className="text-faint" title={`Back to ${parent.title}`} onClick={() => onSelect(parent.id)}>
            <ArrowLeftIcon />
          </Button>
        )}
        <h2 className="min-w-0 truncate text-sm font-medium">{thread.title}</h2>
        <span className={cn('shrink-0 text-xs text-faint', running && 'text-signal', interrupted && 'text-amber-400')}>
          {running ? 'Working' : interrupted ? 'Interrupted' : root.closed ? 'Closed' : ''}
        </span>
        <div className="flex-1" />
        {running && (
          <Button size="sm" variant="outline" onClick={stop}>
            <SquareIcon /> Stop
          </Button>
        )}
        <Button
          size="sm"
          variant={filesOpen ? 'secondary' : 'ghost'}
          className={cn(!filesOpen && 'text-muted-foreground')}
          onClick={onToggleFiles}
          title={`Files in sandbox ${short(thread.sandboxId)}`}
        >
          <FolderIcon /> Files
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={closeTask.isPending}
          onClick={() =>
            closeTask.mutate(
              { threadId: root.id, closed: !root.closed },
              { onError: error => toast.error(error.message) },
            )
          }
          title={root.closed ? 'Reopen the task' : 'Stop every agent in this task and move it to Closed'}
        >
          {root.closed ? 'Reopen' : 'Close'}
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      </div>

      {interrupted && (
        <div className="flex items-center gap-3 border-b bg-amber-400/5 px-4 py-2.5 text-sm">
          <TriangleAlertIcon className="size-4 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 text-muted-foreground">
            A server restart interrupted this agent
            {thread.runStartedAt && ` (its run started ${new Date(thread.runStartedAt).toLocaleString()})`}. Its
            conversation and files are kept; steps it hadn't saved are lost.
            {parent && ' Its parent may still be waiting for its report.'}
          </p>
          <Button size="sm" onClick={resume}>
            <PlayIcon /> Resume
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate({ threadId: thread.id }, { onError: error => toast.error(error.message) })}
          >
            Dismiss
          </Button>
        </div>
      )}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto max-w-[44rem] gap-6 px-6 py-8">
              {messages.map(message => (
                <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={incoming(message)}>
                  <ChatMessage
                    message={message}
                    thread={thread}
                    threads={threads}
                    running={running}
                    isFirstUserMessage={message.id === firstUserId}
                    onSelect={onSelect}
                  />
                </MessageScrollerItem>
              ))}
              {running && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-3.5" /> Working…
                </p>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="absolute bottom-3 left-1/2 -translate-x-1/2" />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="mx-auto w-full max-w-[44rem] px-6 pb-5"
        onSubmit={event => {
          event.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border bg-raised p-1.5 focus-within:border-muted-foreground/50">
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={running ? 'Message this agent. It reads it between steps.' : 'Message this agent'}
            className="max-h-48 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
            rows={1}
          />
          <Button type="submit" size="icon-sm" disabled={!draft.trim()} title="Send (Enter)">
            <ArrowUpIcon />
          </Button>
        </div>
      </form>

      <DeleteThreadDialog
        thread={deleting ? thread : null}
        threads={threads}
        onOpenChange={setDeleting}
        onDeleted={() => onSelect(thread.parentThreadId)}
      />
    </section>
  );
}
