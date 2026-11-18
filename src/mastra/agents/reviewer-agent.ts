import { Agent } from '@mastra/core/agent';
import { reportToParent } from '../tools/agent-threads';
import { toolkits } from '../toolkits';
import { resolveReadOnlyWorkspace } from '../workspaces/sandboxes';
import { memory } from '../memory';
import { withParent } from './shared';

const instructions = `You are a code reviewer working in a cloud sandbox. Review the change you are asked about: read the relevant files, look at git diff and git log, and run the tests and linter.

You can't write or edit files, and you must not change them through commands either. Your job is to report, not to fix.

Report findings in order of importance. For each one give the file and line, what is wrong, and the fix you suggest. Say plainly when you found nothing worth changing.`;

export const reviewerAgent = new Agent({
  id: 'reviewer',
  name: 'Reviewer',
  description: "Reviews code in a sandbox: reads files, runs tests and git diff, and reports problems. Can't write or edit files.",
  // A stronger model for review: it reads more than it writes.
  model: 'anthropic/claude-opus-5-5',
  instructions: withParent(instructions),
  tools: { report_to_parent: reportToParent },
  memory,
  // The same sandbox as the agent that started it, with file tools that can't write.
  workspace: resolveReadOnlyWorkspace,
  skills: toolkits.map(toolkit => toolkit.skill),
  defaultOptions: { maxSteps: 100 },
});
