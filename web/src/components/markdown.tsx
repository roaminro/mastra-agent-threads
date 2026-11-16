import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

/** Agent text is markdown. Streamdown also renders half-streamed markdown cleanly. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      className={cn('min-w-0 space-y-2 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_pre]:text-xs [&_a]:text-foreground [&_a]:underline [&_a]:decoration-faint [&_a]:underline-offset-2', className)}
      shikiTheme={['github-dark', 'github-dark']}
      controls={{ code: true, table: false, mermaid: false }}
    >
      {children}
    </Streamdown>
  );
}
