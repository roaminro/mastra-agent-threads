import { github } from './github';

/**
 * A command-line tool installed in every sandbox, plus the skill that tells
 * the agent how to use it.
 */
export interface Toolkit {
  /** Command name, listed in the sandbox instructions. */
  cli: string;
  /**
   * Shell command that installs the CLI. Runs on every new machine (the
   * machine is replaced when idle; only /mnt/work survives), so make it skip
   * the work when the CLI is already there.
   */
  install: string;
  /** Environment variables the CLI needs. Every agent of every user can read them. */
  env?: Record<string, string | undefined>;
  /**
   * Skill folder holding a SKILL.md, relative to `src/mastra/public`. The
   * build copies that folder next to the server, which loads skills from
   * its working directory.
   */
  skill: string;
}

/** Add a toolkit here to give every sandbox its CLI and every agent its skill. */
export const toolkits: Toolkit[] = [github];
