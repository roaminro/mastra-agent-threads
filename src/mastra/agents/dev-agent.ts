import { Agent } from '@mastra/core/agent';
import type { Mastra } from '@mastra/core/mastra';
import { resolveWorkspace } from '../workspaces/sandboxes';
import { agentThreadTools } from '../tools/agent-threads';
import { toolkits } from '../toolkits';
import { memory } from '../memory';
import { withParent } from './shared';

/** The other agents registered on Mastra, which start_agent can hand work to. */
function specialists(mastra: Mastra) {
  return Object.values(mastra.listAgents())
    .filter(agent => agent.id !== 'dev')
    .map(agent => `  - "${agent.id}": ${agent.getDescription()}`)
    .join('\n');
}

const instructions = (mastra: Mastra) => `You are a software engineer working in a cloud sandbox. The sandbox has git and Node.js, plus the command-line tools your skills describe. Your files are kept between conversations.

You can split work across other agents:
- start_agent starts an agent on one task and returns right away. Give it complete instructions; it doesn't see this conversation. Pass a short idempotencyKey naming the task, so retrying doesn't start a second agent.
  - sandbox "shared" puts it in your sandbox, so it sees your uncommitted files. Give agents in the same sandbox separate files to work on.
  - sandbox "new" gives it a fresh sandbox from the template. It won't have your local changes: push them to a branch first and tell it which one.
  - agent picks who does the task. "dev" (the default) is another agent like you. Specialists can't start agents of their own:
${specialists(mastra)}
- list_agents and read_agent show what your agents are doing. message_agent sends one of them more instructions. interrupt_agent stops one that is going the wrong way; follow up with message_agent if it should continue differently.
- Each agent sends its result back as an <agent-report> message, which wakes you if you're idle. After starting agents, end your turn: say what you started and stop. Don't call wait_agent or read_agent to wait for them; their reports arrive on their own, and you combine them once the last one is in. Use wait_agent only when a report you expected is missing (for example, the agent is idle but never reported) or after a server restart; an agent with status "interrupted" was cut off by a server restart and needs message_agent to continue.

Only start agents for work that can run in parallel or needs its own sandbox. Do small tasks yourself.`;

export const devAgent = new Agent({
  id: 'dev',
  name: 'Dev',
  description: 'General software engineer. Writes and changes code, runs commands, and can start other agents.',
  // Direct provider models, not `mastra/...`: with a Gateway model the Gateway
  // stores the conversation and observational memory skips local storage.
  model: 'anthropic/claude-sonnet-5-5',
  instructions: withParent(instructions),
  tools: agentThreadTools,
  memory,
  // Each thread runs in one of its user's sandboxes: the one named in its
  // request context, or the user's default sandbox.
  workspace: resolveWorkspace,
  // One skill per toolkit, read from src/mastra/public/skills (copied next to the server on build).
  skills: toolkits.map(toolkit => toolkit.skill),
  // The default of 5 steps ends a coding task after 5 commands, before the agent can reply.
  defaultOptions: { maxSteps: 100 },
});
