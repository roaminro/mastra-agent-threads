import { Memory } from '@mastra/memory';

// One memory for every agent, so all threads live in the same store and the
// tools and routes can import it directly. It's registered on the Mastra
// instance (src/mastra/index.ts), which gives it Mastra's storage.
// Observational memory compresses long tool output (logs, test runs) into
// observations, so long-running threads stay small.
export const memory = new Memory({
  options: { observationalMemory: { model: 'anthropic/claude-haiku-5-5' } },
});
