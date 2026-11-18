import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Mastra } from '@mastra/core/mastra';
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';
import { ModalFilesystem, ModalSandbox } from '@mastra/modal';
import { ModalClient } from 'modal';
import { toolkits } from '../toolkits';
import { memory } from '../memory';
import type { Volume } from 'modal';

/** Request context key that names the sandbox a thread runs in. */
export const SANDBOX_ID_KEY = 'sandboxId';

/** Each user's sandbox for threads they start directly (from the app or Studio). */
export const DEFAULT_SANDBOX_ID = 'main';

/** Sandbox ids `start_agent` creates. Anything else in the request context is rejected. */
const NEW_SANDBOX_ID = /^sb-[0-9a-f-]{36}$/;

const onModal = Boolean(process.env.MODAL_TOKEN_ID && process.env.MODAL_TOKEN_SECRET);

// Environment variables the toolkits' CLIs need, skipping unset ones.
const env = Object.fromEntries(
  toolkits.flatMap(toolkit => Object.entries(toolkit.env ?? {})).filter(([, value]) => value !== undefined),
) as Record<string, string>;
const clis = toolkits.map(toolkit => toolkit.cli).join(', ');

/** Where each sandbox's folder of the user's volume is mounted. */
const FILES = '/mnt/work';

// The machine is replaced whenever it times out, so the toolkits' CLIs are
// installed on each new one. Only the files on the volume carry over.
//
// Mastra marks a sandbox running before its onStart hook finishes, so without
// a gate the agent's first command can run while the install is still going
// and find no CLI. Commands therefore wait for the install in progress.
function installToolkitsBeforeCommands(sandbox: ModalSandbox) {
  const run = sandbox.executeCommand!.bind(sandbox);
  let installing: Promise<void> | undefined;
  sandbox.executeCommand = async (...args) => {
    await installing?.catch(() => {});
    return run(...args);
  };
  const install = async () => {
    for (const toolkit of toolkits) {
      const result = await run(toolkit.install);
      if (result.exitCode !== 0) throw new Error(`Installing ${toolkit.cli} failed: ${result.stderr}`);
    }
  };
  sandbox.setOnStart(() => async () => {
    installing = install();
    await installing;
  });
}

let modal: ModalClient | undefined;
const volumes = new Map<string, Promise<Volume>>();

/**
 * One Modal volume per user, created on first use. Each of the user's
 * sandboxes mounts only its own folder of it, so storage doesn't grow with
 * threads: a user has one volume and a folder per sandbox.
 */
function userVolume(key: string) {
  let volume = volumes.get(key);
  if (!volume) {
    modal ??= new ModalClient();
    volume = modal.volumes.fromName(`work-${key}`, { createIfMissing: true, version: 2 });
    volume.catch(() => volumes.delete(key));
    volumes.set(key, volume);
  }
  return volume;
}

/** A short, stable, path- and id-safe key for a user. */
function userKey(resourceId: string) {
  return createHash('sha256').update(resourceId).digest('hex').slice(0, 16);
}

async function createWorkspace(resourceId: string, sandboxId: string): Promise<Workspace> {
  const key = userKey(resourceId);
  // The user is part of every sandbox's identity, so two users asking for the
  // same sandbox id (`main`, say) never reach the same machine or files.
  const id = `${key}-${sandboxId}`;
  const workspace = { id: `sandbox-${id}`, name: `Sandbox ${sandboxId}` };

  if (!onModal) {
    const directory = `.sandboxes/${key}/${sandboxId}`;
    return new Workspace({
      ...workspace,
      filesystem: new LocalFilesystem({ basePath: directory }),
      sandbox: new LocalSandbox({ workingDirectory: directory, env: { ...process.env, ...env } }),
    });
  }

  // The machine is disposable: it stops after an hour and the next command
  // starts a new one. The files live on the volume, so they survive it.
  // Agents in a shared sandbox share the machine and the folder; agents in
  // different sandboxes hand work over through git.
  const volume = await userVolume(key);
  const sandbox = new ModalSandbox({
    id,
    appName: 'agent-threads',
    baseImage: 'node:22-bookworm',
    timeoutMs: 60 * 60_000,
    env,
    volumes: { [FILES]: volume.withMountOptions({ subPath: sandboxId }) },
    // The file tools resolve every path inside ${FILES}, so an absolute
    // "${FILES}/notes.txt" would land in ${FILES}${FILES}/notes.txt.
    instructions: `Linux sandbox with git, Node.js, and ${clis}. Your files are in ${FILES} and are kept between conversations; the machine itself is replaced when idle, so anything outside ${FILES} (global installs, running servers) doesn't last. Run commands with cwd "${FILES}". File tools (read, write, list) take paths relative to ${FILES}: write "notes.txt", not "${FILES}/notes.txt".`,
  });
  installToolkitsBeforeCommands(sandbox);
  return new Workspace({ ...workspace, sandbox, filesystem: new ModalFilesystem({ sandbox, basePath: FILES }) });
}

const MAX_CACHED_WORKSPACES = 500;
const cacheKey = (resourceId: string, sandboxId: string) => `${resourceId}\u0000${sandboxId}`;
const workspaces = new Map<string, Promise<Workspace>>();

/**
 * The workspace for one of a user's sandboxes. Cached, because an agent
 * resolves its workspace several times per run and each call must reach the
 * same machine. The oldest entries are dropped past the limit; the next run
 * reconnects to the same sandbox by id.
 */
function workspaceFor(resourceId: string, sandboxId: string): Promise<Workspace> {
  const key = cacheKey(resourceId, sandboxId);
  let workspace = workspaces.get(key);
  if (workspace) {
    workspaces.delete(key);
  } else {
    workspace = createWorkspace(resourceId, sandboxId);
    workspace.catch(() => workspaces.delete(key));
    if (workspaces.size >= MAX_CACHED_WORKSPACES) workspaces.delete(workspaces.keys().next().value!);
  }
  workspaces.set(key, workspace);
  return workspace;
}

/**
 * Whether `sandboxId` is one of the user's sandboxes. The request context comes
 * partly from the client, so a sandbox id there is only trusted once a thread
 * of the same user is recorded as using it.
 */
async function ownsSandbox(resourceId: string, sandboxId: string) {
  if (sandboxId === DEFAULT_SANDBOX_ID) return true;
  if (!NEW_SANDBOX_ID.test(sandboxId)) return false;
  if (workspaces.has(cacheKey(resourceId, sandboxId))) return true;
  const { total } = await memory.listThreads({ filter: { resourceId, metadata: { sandboxId } }, perPage: 1 });
  return total > 0;
}

/**
 * The agent's `workspace` option. The user comes from the reserved resource id,
 * which only the server sets (from the signed-in user, or from the tools in
 * `tools/agent-threads.ts` when they wake a thread). Without a user there is
 * no workspace, so no sandbox can start for an anonymous caller.
 */
export async function resolveWorkspace({
  requestContext,
  mastra,
}: {
  requestContext: { get(key: string): unknown };
  mastra?: Mastra;
}): Promise<Workspace | undefined> {
  const resourceId = requestContext.get(MASTRA_RESOURCE_ID_KEY) as string | undefined;
  if (!resourceId || !mastra) return undefined;
  const sandboxId = (requestContext.get(SANDBOX_ID_KEY) as string | undefined) ?? DEFAULT_SANDBOX_ID;
  if (!(await ownsSandbox(resourceId, sandboxId))) {
    throw new Error(`Sandbox ${sandboxId} doesn't exist or belongs to another user.`);
  }
  return workspaceFor(resourceId, sandboxId);
}

const readOnlyWorkspaces = new Map<string, Promise<Workspace>>();

/**
 * A read-only view of the same sandbox: same machine and files, but the file
 * tools can't write, so the agent gets no write or edit tools. Commands still
 * run, so it can run tests; a command can still change files.
 */
async function readOnlyWorkspaceFor(resourceId: string, sandboxId: string): Promise<Workspace> {
  const base = await workspaceFor(resourceId, sandboxId);
  const key = cacheKey(resourceId, sandboxId);
  const cached = readOnlyWorkspaces.get(key);
  if (cached && (await cached).sandbox === base.sandbox) return cached;
  const filesystem = onModal
    ? new ModalFilesystem({ sandbox: base.sandbox as ModalSandbox, basePath: FILES, readOnly: true })
    : new LocalFilesystem({ basePath: `.sandboxes/${userKey(resourceId)}/${sandboxId}`, readOnly: true });
  const workspace = Promise.resolve(
    new Workspace({ id: `${base.id}-read-only`, name: `${base.name} (read-only)`, sandbox: base.sandbox, filesystem }),
  );
  if (readOnlyWorkspaces.size >= MAX_CACHED_WORKSPACES) readOnlyWorkspaces.delete(readOnlyWorkspaces.keys().next().value!);
  readOnlyWorkspaces.set(key, workspace);
  return workspace;
}

/** Like `resolveWorkspace`, but the file tools can't write. */
export async function resolveReadOnlyWorkspace(options: Parameters<typeof resolveWorkspace>[0]) {
  const workspace = await resolveWorkspace(options);
  if (!workspace) return undefined;
  const resourceId = options.requestContext.get(MASTRA_RESOURCE_ID_KEY) as string;
  const sandboxId = (options.requestContext.get(SANDBOX_ID_KEY) as string | undefined) ?? DEFAULT_SANDBOX_ID;
  return readOnlyWorkspaceFor(resourceId, sandboxId);
}

/** The workspace for one of the user's sandboxes, for the app's file routes. Ownership must be checked first. */
export function sandboxWorkspace(resourceId: string, sandboxId: string) {
  return workspaceFor(resourceId, sandboxId);
}

/**
 * Lists one folder of a sandbox's files. On Modal the volume mount is a
 * symlink, and `ModalFilesystem.readdir` doesn't follow it at the root (it
 * returns nothing), so this lists through the machine with `ls` instead.
 */
export async function listSandboxFiles(resourceId: string, sandboxId: string, path: string) {
  const workspace = await workspaceFor(resourceId, sandboxId);
  if (!onModal) {
    if (!(await workspace.filesystem!.exists(path))) return [];
    return (await workspace.filesystem!.readdir(path)).map(({ name, type }) => ({ name, type }));
  }
  const dir = path === '.' ? `${FILES}/` : `${FILES}/${path}/`;
  const result = await workspace.sandbox!.executeCommand!('ls', ['-1pA', dir]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map(line =>
      line.endsWith('/')
        ? { name: line.slice(0, -1), type: 'directory' as const }
        : { name: line, type: 'file' as const },
    );
}

/**
 * Deletes a sandbox's files and stops its machine. `main` is never deleted.
 * On Modal, removing the folder's contents needs a running machine, so this
 * can take as long as a machine start.
 */
export async function deleteSandbox(resourceId: string, sandboxId: string) {
  if (sandboxId === DEFAULT_SANDBOX_ID || !NEW_SANDBOX_ID.test(sandboxId)) return;
  const key = cacheKey(resourceId, sandboxId);
  readOnlyWorkspaces.delete(key);
  if (!onModal) {
    workspaces.delete(key);
    await rm(`.sandboxes/${userKey(resourceId)}/${sandboxId}`, { recursive: true, force: true });
    return;
  }
  const workspace = await workspaceFor(resourceId, sandboxId);
  workspaces.delete(key);
  const sandbox = workspace.sandbox!;
  // The trailing slash makes find follow the mount, which is a symlink.
  await sandbox.executeCommand!(`find ${FILES}/ -mindepth 1 -delete && sync ${FILES}`);
  await sandbox.destroy!();
}
