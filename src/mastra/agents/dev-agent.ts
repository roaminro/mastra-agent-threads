import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { resolveWorkspace } from '../workspaces/sandboxes';
import { PARENT_THREAD_ID_KEY, agentThreadTools } from '../tools/agent-threads';
import { toolkits } from '../toolkits';

const instructions = `You are a software engineer working in a cloud sandbox. The sandbox has git and Node.js, plus the command-line tools your skills describe. Your files are kept between conversations.

You can split work across other agents:
- start_agent starts an agent on one task and returns right away. Give it complete instructions; it doesn't see this conversation. Pass a short idempotencyKey naming the task, so retrying doesn't start a second agent.
  - sandbox "shared" puts it in your sandbox, so it sees your uncommitted files. Give agents in the same sandbox separate files to work on.
  - sandbox "new" gives it a fresh sandbox from the template. It won't have your local changes: push them to a branch first and tell it which one.
- list_agents and read_agent show what your agents are doing. message_agent sends one of them more instructions. interrupt_agent stops one that is going the wrong way; follow up with message_agent if it should continue differently.
- Each agent sends its result back as an <agent-report> message. Wait for the reports instead of polling, then combine them. If a report you expected hasn't arrived, wait_agent returns it; an agent with status "interrupted" was cut off by a server restart and needs message_agent to continue.

Only start agents for work that can run in parallel or needs its own sandbox. Do small tasks yourself.`;

export const devAgent = new Agent({
  id: 'dev',
  name: 'Dev Agent',
  // Direct provider models, not `mastra/...`: with a Gateway model the Gateway
  // stores the conversation and observational memory skips local storage.
  model: 'anthropic/claude-sonnet-5-5',
  instructions: ({ requestContext }) => {
    const parent = requestContext.get(PARENT_THREAD_ID_KEY) as string | undefined;
    if (!parent) return instructions;
    return `${instructions}

Another agent (thread ${parent}) started you. When your task is done, or you're blocked, call report_to_parent once with a summary of what you did, what changed and where, and anything left open.`;
  },
  tools: agentThreadTools,
  // Observational memory compresses long tool output (logs, test runs) into
  // observations, so long-running threads stay small.
  memory: new Memory({ options: { observationalMemory: { model: 'anthropic/claude-haiku-5-5' } } }),
  // Each thread runs in one of its user's sandboxes: the one named in its
  // request context, or the user's default sandbox.
  workspace: resolveWorkspace,
  // One skill per toolkit, read from src/mastra/public/skills (copied next to the server on build).
  skills: toolkits.map(toolkit => toolkit.skill),
  // The default of 5 steps ends a coding task after 5 commands, before the agent can reply.
  defaultOptions: { maxSteps: 100 },
});
