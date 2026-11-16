import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { type AgentThread, subtreeOf, useDeleteThread } from '@/lib/api';

/**
 * Confirms deleting a thread and every agent below it. Shows which sandboxes
 * go with it (those no other thread uses) and which stay.
 */
export function DeleteThreadDialog({
  thread,
  threads,
  onOpenChange,
  onDeleted,
}: {
  thread: AgentThread | null;
  threads: AgentThread[];
  onOpenChange: (open: boolean) => void;
  onDeleted: (deleted: string[]) => void;
}) {
  const deleteThread = useDeleteThread();
  const doomed = thread ? subtreeOf(threads, thread.id) : [];
  const ids = new Set(doomed.map(t => t.id));
  const sandboxes = [...new Set(doomed.map(t => t.sandboxId))];
  const stillUsed = (sandboxId: string) => threads.some(t => !ids.has(t.id) && t.sandboxId === sandboxId);
  const freed = sandboxes.filter(s => s !== 'main' && !stillUsed(s));
  const kept = sandboxes.filter(s => !freed.includes(s));

  return (
    <AlertDialog open={Boolean(thread)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{thread?.title}”?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Deletes {doomed.length} thread{doomed.length === 1 ? '' : 's'}
                {doomed.length > 1 && ', including every agent it started'}:
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {doomed.map(t => (
                  <li key={t.id}>
                    {t.title}
                    {t.running && <span className="text-signal"> (running, will be stopped)</span>}
                  </li>
                ))}
              </ul>
              {freed.length > 0 && (
                <p>
                  Also deletes the files in{' '}
                  {freed.map(s => (
                    <Badge key={s} variant="outline" className="mr-1 font-mono">
                      {short(s)}
                    </Badge>
                  ))}
                  , which nothing else uses.
                </p>
              )}
              {kept.length > 0 && (
                <p>
                  Keeps{' '}
                  {kept.map(s => (
                    <Badge key={s} variant="outline" className="mr-1 font-mono">
                      {short(s)}
                    </Badge>
                  ))}
                  {kept.includes('main') && kept.length === 1 ? '(never deleted).' : 'still used elsewhere.'}
                </p>
              )}
              <p>This can't be undone.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              thread &&
              deleteThread.mutate(thread.id, {
                onSuccess: ({ deleted }) => onDeleted(deleted),
                onError: error => toast.error(error.message),
              })
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** `sb-7f70c688-…` → `sb-7f70c688`. */
export const short = (sandboxId: string) => sandboxId.split('-').slice(0, 2).join('-');
