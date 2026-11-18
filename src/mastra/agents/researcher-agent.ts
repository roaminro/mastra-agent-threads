import { Agent } from '@mastra/core/agent';
import { webFetchTool, webSearchTool } from '@mastra/core/tools';
import { reportToParent } from '../tools/agent-threads';
import { resolveWorkspace } from '../workspaces/sandboxes';
import { memory } from '../memory';
import { withParent } from './shared';

const instructions = `You are a researcher. Answer the question you are given using web search and the pages you read.

Keep the answer short and specific. Cite the URL for every claim, and say when sources disagree or you couldn't find something.`;

export const researcherAgent = new Agent({
  id: 'researcher',
  name: 'Researcher',
  description: 'Searches the web and reads pages to answer a question, with sources.',
  // A small, fast model is enough for searching and summarizing.
  model: 'anthropic/claude-haiku-5-5',
  instructions: withParent(instructions),
  tools: { web_search: webSearchTool, web_fetch: webFetchTool, report_to_parent: reportToParent },
  memory,
  workspace: resolveWorkspace,
  defaultOptions: { maxSteps: 30 },
});
