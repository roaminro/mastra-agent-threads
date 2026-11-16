import { useState } from 'react';
import { FileIcon, FolderIcon } from 'lucide-react';
import { short } from '@/components/delete-thread-dialog';
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from '@/components/ui/code-block';
import { Spinner } from '@/components/ui/spinner';
import { type AgentThread, useFile, useFiles } from '@/lib/api';
import { cn } from '@/lib/utils';

/** The thread's sandbox: who shares it, and its files (read-only). */
export function FilesPanel({ thread, threads }: { thread: AgentThread; threads: AgentThread[] }) {
  const [dir, setDir] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const files = useFiles(thread.id, dir);
  const content = useFile(thread.id, file);
  const sharing = threads.filter(t => t.sandboxId === thread.sandboxId);
  const parts = dir ? dir.split('/') : [];

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l p-3">
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        Sandbox <span className="font-mono text-violet-300">{short(thread.sandboxId)}</span> · files in{' '}
        <code>/mnt/work</code>
        <br />
        {sharing.length} agent{sharing.length === 1 ? '' : 's'} use it ·{' '}
        {sharing.some(t => t.running) ? <span className="text-emerald-400">working now</span> : 'idle'}
      </div>

      <nav className="flex flex-wrap items-center gap-1 text-sm">
        <button className="text-sky-400 hover:underline" onClick={() => setDir('')}>
          /mnt/work
        </button>
        {parts.map((part, i) => (
          <span key={i}>
            /{' '}
            <button className="text-sky-400 hover:underline" onClick={() => setDir(parts.slice(0, i + 1).join('/'))}>
              {part}
            </button>
          </span>
        ))}
      </nav>

      {files.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Starting the sandbox…
        </p>
      ) : files.isError ? (
        <p className="text-sm text-destructive">{files.error.message}</p>
      ) : files.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="text-sm">
          {files.data.map(entry => {
            const path = dir ? `${dir}/${entry.name}` : entry.name;
            return (
              <li
                key={entry.name}
                onClick={() => (entry.type === 'directory' ? setDir(path) : setFile(path))}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted',
                  path === file && 'bg-muted',
                )}
              >
                {entry.type === 'directory' ? (
                  <FolderIcon className="size-4 text-sky-400" />
                ) : (
                  <FileIcon className="size-4 text-muted-foreground" />
                )}
                <span className="truncate">{entry.name}</span>
              </li>
            );
          })}
        </ul>
      )}

      {file && (
        <CodeBlock size="sm">
          <CodeBlockHeader>
            <CodeBlockTitle>/mnt/work/{file}</CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent lineNumbers className="max-h-96">
            {content.data ? content.data.content + (content.data.truncated ? '\n…' : '') : content.isError ? content.error.message : 'Loading…'}
          </CodeBlockContent>
        </CodeBlock>
      )}
    </aside>
  );
}
