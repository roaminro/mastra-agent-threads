import { useState } from 'react';
import { toast } from 'sonner';
import { short } from '@/components/delete-thread-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type AgentThread, useStartTask } from '@/lib/api';
import { cn } from '@/lib/utils';

export function NewTaskDialog({
  threads,
  open,
  onOpenChange,
  onStarted,
}: {
  threads: AgentThread[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (threadId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [task, setTask] = useState('');
  const [sandbox, setSandbox] = useState('main');
  const startTask = useStartTask();
  const existing = [...new Set(threads.map(t => t.sandboxId))].filter(s => s !== 'main');

  const options = [
    { value: 'main', label: 'main', hint: 'Your default sandbox and its files' },
    { value: 'new', label: 'New sandbox', hint: 'An empty folder of its own' },
    ...existing.map(s => ({ value: s, label: short(s), hint: 'An existing sandbox' })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="flex flex-col gap-3"
          onSubmit={event => {
            event.preventDefault();
            startTask.mutate(
              { title, task, sandbox },
              {
                onSuccess: ({ threadId }) => {
                  onOpenChange(false);
                  setTitle('');
                  setTask('');
                  setSandbox('main');
                  onStarted(threadId);
                },
                onError: error => toast.error(error.message),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>An agent starts on it right away. It can split the work across other agents.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} required />
          <Label htmlFor="task">Instructions</Label>
          <Textarea id="task" value={task} onChange={e => setTask(e.target.value)} rows={5} required />
          <Label>Sandbox</Label>
          <div className="grid grid-cols-2 gap-2">
            {options.map(option => (
              <button
                type="button"
                key={option.value}
                onClick={() => setSandbox(option.value)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm',
                  sandbox === option.value && 'border-sky-500 bg-sky-500/10',
                )}
              >
                <div className="font-medium">{option.label}</div>
                <div className="text-xs text-muted-foreground">{option.hint}</div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={startTask.isPending || !title || !task}>
              Start agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
