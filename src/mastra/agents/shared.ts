import type { Mastra } from '@mastra/core/mastra';
import { PARENT_THREAD_ID_KEY } from '../tools/agent-threads';

type Instructions = string | ((mastra: Mastra) => string);

/** Instructions that add the report_to_parent rule when another agent started this thread. */
export function withParent(instructions: Instructions) {
  return ({ requestContext, mastra }: { requestContext: { get(key: string): unknown }; mastra?: Mastra }) => {
    const text = typeof instructions === 'string' ? instructions : instructions(mastra!);
    const parent = requestContext.get(PARENT_THREAD_ID_KEY) as string | undefined;
    if (!parent) return text;
    return `${text}

Another agent (thread ${parent}) started you. When your task is done, or you're blocked, call report_to_parent once with a summary of what you did, what changed and where, and anything left open.`;
  };
}
