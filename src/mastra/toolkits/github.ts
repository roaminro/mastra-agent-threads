import type { Toolkit } from '.';

/** The GitHub CLI. It needs GH_TOKEN; without one the skill tells the agent to read public repos through the REST API. */
export const github: Toolkit = {
  cli: 'gh',
  install: 'command -v gh >/dev/null || (apt-get update -qq && apt-get install -y -qq gh)',
  env: { GH_TOKEN: process.env.GH_TOKEN },
  skill: './skills/github',
};
