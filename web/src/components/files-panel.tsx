import { useState } from 'react';
import { FileIcon, FolderIcon } from 'lucide-react';
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from '@/components/ui/code-block';
import { Spinner } from '@/components/ui/spinner';
import { type AgentThread, useFile, useFiles } from '@/lib/api';
import { cn } from '@/lib/utils';

/** The thread's sandbox files (read-only). */
export function FilesPanel({ thread }: { thread: AgentThread }) {
  const [dir, setDir] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const files = useFiles(thread.id, dir);
  const content = useFile(thread.id, file);
  const parts = dir ? dir.split('/') : [];

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l p-4">
      <nav className="flex h-4 flex-wrap items-center font-mono text-xs text-faint">
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
        <p className="flex items-center gap-2 text-sm text-faint">
          <Spinner className="size-3.5" /> Starting the sandbox…
        </p>
      ) : files.isError ? (
        <p className="text-sm text-destructive">{files.error.message}</p>
      ) : files.data.length === 0 ? (
        <p className="text-sm text-faint">No files yet.</p>
      ) : (
        <ul className="-mx-2 font-mono text-xs">
          {files.data.map(entry => {
            const path = dir ? `${dir}/${entry.name}` : entry.name;
            return (
              <li
                key={entry.name}
                onClick={() => (entry.type === 'directory' ? setDir(path) : setFile(path))}
                className={cn(
                  'flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
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
