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
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l bg-rail p-4">
      <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 font-mono text-[11px]">
        <dt className="text-faint">sandbox</dt>
        <dd className="text-muted-foreground">{short(thread.sandboxId)}</dd>
        <dt className="text-faint">used by</dt>
        <dd className="text-muted-foreground">
          {sharing.length} agent{sharing.length === 1 ? '' : 's'}
        </dd>
        <dt className="text-faint">state</dt>
        <dd className={sharing.some(t => t.running) ? 'text-signal' : 'text-muted-foreground'}>
          {sharing.some(t => t.running) ? 'working' : 'idle'}
        </dd>
      </dl>

      <nav className="flex flex-wrap items-center border-b pb-2 font-mono text-xs text-faint">
        <button className="hover:text-foreground" onClick={() => setDir('')}>
          /mnt/work
        </button>
        {parts.map((part, i) => (
          <span key={i}>
            /
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setDir(parts.slice(0, i + 1).join('/'))}>
              {part}
            </button>
          </span>
        ))}
      </nav>

      {files.isPending ? (
        <p className="flex items-center gap-2 font-mono text-xs text-faint">
          <Spinner className="size-3" /> starting the sandbox
        </p>
      ) : files.isError ? (
        <p className="text-sm text-destructive">{files.error.message}</p>
      ) : files.data.length === 0 ? (
        <p className="font-mono text-xs text-faint">empty</p>
      ) : (
        <ul className="-mx-2 font-mono text-xs">
          {files.data.map(entry => {
            const path = dir ? `${dir}/${entry.name}` : entry.name;
            return (
              <li
                key={entry.name}
                onClick={() => (entry.type === 'directory' ? setDir(path) : setFile(path))}
                className={cn(
                  'flex h-6 cursor-pointer items-center gap-2 rounded px-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  path === file && 'bg-muted text-foreground',
                )}
              >
                {entry.type === 'directory' ? (
                  <FolderIcon className="size-3.5 text-faint" />
                ) : (
                  <FileIcon className="size-3.5 text-faint" />
                )}
                <span className="truncate">
                  {entry.name}
                  {entry.type === 'directory' && '/'}
                </span>
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
