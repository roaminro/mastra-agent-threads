# Agent threads

A proof of concept for cloud coding agents in the style of [boxes.dev](https://boxes.dev). You give an agent a task in a web app. It works in a cloud sandbox, and it can split the work across other agents, each in the same sandbox or a fresh one. You can watch every agent, message one mid-task, stop it, and browse its files.

It's one Mastra agent (`dev`), deployable to Mastra Platform. Sandboxes run on [Modal](https://modal.com), with each user's files on a durable Modal volume. Without a Modal token, sandboxes are folders on your machine.

## Quick start

You need Node.js 22+, pnpm, and an Anthropic API key. A Modal account is optional.

1. **Configure.**

   ```bash
   pnpm install --ignore-workspace
   cp .env.example .env
   ```

   In `.env`, set:

   | Variable | Required | What it's for |
   | - | - | - |
   | `ANTHROPIC_API_KEY` | Yes | Claude Sonnet 5.5 runs the agent; Claude Haiku 5.5 runs observational memory. |
   | `APP_USERS` | Yes | Sign-in tokens. The example gives you `sk-alice` and `sk-bob`. |
   | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | No | Run sandboxes on Modal (modal.com → Settings → API Tokens). Leave empty to run them as folders under `.sandboxes/` on your machine. |
   | `GH_TOKEN` | No | Lets the `gh` CLI in sandboxes call GitHub. Public repos clone without it. |

2. **Start the server.** It serves the agent, Studio, and the app's API on http://localhost:4111.

   ```bash
   pnpm mastra dev
   ```

3. **Start the web app** in a second terminal, then open http://localhost:5173 and sign in with `sk-alice`.

   ```bash
   cd web && pnpm install && pnpm dev
   ```

   If the server started on another port (it moves to 4112 when 4111 is taken), run `MASTRA_URL=http://localhost:4112 pnpm dev` instead.

## Using the app

The screen has three columns.

- **Agents (left).** Your tasks, with the agents each one started nested underneath. A green pulsing dot means the agent is working, gray means idle, and amber means a server restart interrupted it. A blue dot and a bold title mean the task finished since you last opened it: its agent replied and none of its agents are still working. The header and the browser tab show how many tasks are waiting for you; opening one clears it. The badge is the agent's sandbox. Below the tree are your sandboxes, how many agents use each, and how close you are to the limits.
- **Conversation (middle).** The selected agent's messages. Each command it ran is a line you can expand to see the output. When it starts another agent, a dashed line links to that agent; when a child finishes, its report appears as a green card (yellow if it got blocked). Type in the box at the bottom to message the agent: while it works, the message reaches it mid-task; otherwise it wakes it up.
- **Files (right).** The agent's sandbox folder (`/mnt/work`), read-only. Click folders to open them and files to view them.

Actions:

- **New task** (top right) starts a top-level agent. Give it a title, instructions, and a sandbox: `main` (your default sandbox and its files), a new empty sandbox, or one of your existing sandboxes.
- **Stop** ends the agent's current run. It keeps its conversation and files; message it to continue.
- **Close task** stops every agent in the task and moves it to *Closed*. **Reopen** brings it back.
- **Delete** removes the task, every agent under it, and the files of any sandbox nothing else uses. You see what will be deleted before confirming. `main` is never deleted.
- **Resume** and **Dismiss** appear on an agent that a server restart interrupted. Resume asks it to check its files and continue; Dismiss clears the warning.

You can also open any agent's thread in Studio at http://localhost:4111. Messages sent from Studio run in your `main` sandbox, though, so use the app for agents in other sandboxes.

## Example tasks

Paste these into **New task**. They use only public repositories, so they work without `GH_TOKEN`. Each user can have 5 sandboxes besides `main`; if an agent says it can't create one, delete tasks you no longer need.

**One agent, one sandbox**

> Clone https://github.com/sindresorhus/slugify into /mnt/work/slugify, install its dependencies, run the tests, and summarize the results.

Open the files panel while it works to watch the folder fill up.

**Two agents sharing a sandbox**

> Clone https://github.com/sindresorhus/slugify into /mnt/work/slugify and install its dependencies. Then start two agents in the shared sandbox: one runs the linter and lists every warning, the other runs the tests and lists any failures. When both report back, combine their findings into one summary.

Both children see the clone because they share the sandbox. Their reports arrive as green cards and wake the parent.

**An agent in its own sandbox**

> Start an agent in a new sandbox that writes a small Node.js script printing the first 20 Fibonacci numbers, runs it, and reports the output. Meanwhile, write notes.txt in your own sandbox listing what you asked it to do.

Select the child: its files panel shows only its own sandbox, separate from the parent's.

**Talking to an agent mid-task**

> Count to 12 in /mnt/work/count.txt: for each number, run a separate command that sleeps 3 seconds and then appends the number. Then tell me the last line.

While it runs, select it and type "Stop at 5 instead". The agent reads the message between commands and stops early. (A message can't cut into a command that's already running; use **Stop** for that.)

**A server restart**

Start the counting task, then stop `pnpm mastra dev` with Ctrl+C and start it again. The agent turns amber and shows an *interrupted* banner. Click **Resume**, and it checks `count.txt` and carries on.

## How it works

It doesn't use Mastra's built-in subagents. Every agent is a normal thread of the one `dev` agent, so they run independently and each can be opened on its own. Seven tools in `src/mastra/tools/agent-threads.ts` do the work:

| Tool | What it does |
| - | - |
| `start_agent` | Creates a thread for the task and starts it with `agent.sendMessage()`. Returns the thread ID without waiting. `sandbox` is `shared` (the caller's sandbox and its uncommitted files), `new` (a fresh sandbox from the template), or an existing sandbox ID. With an `idempotencyKey`, calling it again returns the agent it already started instead of starting a second one. |
| `message_agent` | Sends a signal to another thread of the same user. It reaches the agent mid-task, or wakes it if idle. |
| `interrupt_agent` | Stops a child's run mid-task and drops messages it hasn't read. The thread and sandbox stay, so `message_agent` can give it new instructions. Only works on the caller's own children. |
| `report_to_parent` | The child's result. It's saved on the child's thread first, then sent as a notification signal that wakes the parent. |
| `wait_agent` | A child's status (`running`, `interrupted`, `idle`) and its saved report, optionally waiting up to 5 minutes while it runs. Recovers a report whose signal was lost. |
| `list_agents` | The caller's children, their sandboxes, status, and whether they've reported. |
| `read_agent` | A child's latest messages, without interrupting it. |

### Sandboxes and files

- **Files.** Each user has one Modal volume (`work-<user-hash>`), created on first use. Every sandbox mounts only its own folder of it at `/mnt/work`, through `volume.withMountOptions({ subPath: sandboxId })`. `ModalFilesystem` points the agent's file tools at the same folder, so file tools and commands see the same files with no copying, and storage grows by one folder per sandbox rather than per thread.
- **Machines.** A sandbox's VM (`ModalSandbox`, `node:22-bookworm` with `gh` installed on start) is disposable. It stops after an hour, and the next command starts a new one with the same folder mounted. Agents in a shared sandbox share the VM and the folder; agents in different sandboxes hand work over through git.
- **Locally.** Without `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`, each sandbox is a folder under `.sandboxes/<user>/` on your machine.

### Several users

The app is built for many users sharing one deployment:

- **Sign-in.** `server.auth` maps each signed-in user to a memory resource ID with `mapUserToResourceId`. The server puts it in a reserved request context key that clients can't set, and rejects access to other users' threads. `SimpleAuth` with tokens from `APP_USERS` is a placeholder; swap in your identity provider.
- **Sandboxes per user.** Every sandbox ID includes a hash of the user, so each user gets their own `main` sandbox and two users can never reach the same machine. A sandbox ID in the request context comes partly from the client, so it's only accepted if one of the same user's threads uses it. Without a signed-in user the agent has no workspace at all.
- **Threads per user.** `message_agent`, `read_agent`, and `start_agent` (with a sandbox ID) only accept the caller's own threads and sandboxes.
- **Limits.** Agents nest at most 2 levels deep, one thread starts at most 5 agents, each user has at most 5 sandboxes besides `main`, and at most 10 of a user's agents run at once.

### Restarts

Agent runs live in the server's memory, so a crash or restart ends them and nothing resumes them on its own. `src/mastra/runs.ts` records each running thread in its metadata, tagged with the server process; a run recorded by an earlier process is shown as *interrupted*. Conversations up to the last saved step and the files in `/mnt/work` survive; a step that wasn't saved is lost, and resuming may repeat it. A child's report is saved on its own thread before the parent is signalled, so a parent can still get it with `wait_agent` if the signal was lost.

### Code

| File | What it holds |
| - | - |
| `src/mastra/index.ts` | The Mastra instance: storage, sign-in, app routes, run tracker |
| `src/mastra/agents/dev-agent.ts` | The `dev` agent and its instructions |
| `src/mastra/tools/agent-threads.ts` | The seven agent-thread tools and the limits |
| `src/mastra/workspaces/sandboxes.ts` | Modal sandboxes and volumes, the local fallback, and ownership checks |
| `src/mastra/routes/app.ts` | The web app's routes |
| `src/mastra/runs.ts` | Tracks running threads so interrupted runs can be shown |
| `web/` | The web app: Vite, React 19, Tailwind v4, shadcn/ui with AI Elements, and `@mastra/react`'s `useChat` with thread signals |

The app's routes, all scoped to the signed-in user: `GET /app/me`, `GET /app/threads` (the tree), `POST /app/tasks`, `POST /app/threads/:id/close`, `POST /app/threads/:id/dismiss`, `POST /app/threads/:id/seen`, `DELETE /app/threads/:id`, and `GET /app/threads/:id/files` and `/file`. Chat goes through Mastra's built-in agent and memory routes.

Open `architecture.html` for diagrams.

## Deploy

Not tried yet. The steps should be:

```bash
npx mastra env db create --kind turso   # hosted database for threads
npx mastra deploy
```

In the Platform environment, set `ANTHROPIC_API_KEY`, `APP_USERS` (or replace `SimpleAuth` in `src/mastra/index.ts` with a real identity provider), `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, and optionally `GH_TOKEN`. Build the web app with `pnpm build` and serve `web/dist` from a host that forwards `/api` and `/app` to the deployed server.

## Known gaps

- **One GitHub token for everyone.** `GH_TOKEN` goes into every user's sandboxes, where any user's agent can read it. Keep it read-only, or give each user their own credential (for example through Connect) before production.
- **Several server instances.** Signals reach a running thread only within one server process, and the running-agents limit counts only that process. If Platform runs more than one instance, configure a shared PubSub backend (Redis or Valkey streams).
- **Deleting only from the app.** The app's Delete removes unused sandboxes' files (an empty folder entry stays on the volume). Threads deleted any other way, such as from Studio, still leave their folder behind.
- **Use direct provider models, not `mastra/...`.** With a Mastra Gateway model, the Gateway stores the conversation and observational memory skips local storage, so threads end up outside this app's database. The Gateway's copy also showed tool calls without results and calls that never ran.
- **Idle machines keep running.** A VM runs until its one-hour limit even when idle, and a command running at that moment is cut off.
- **Studio messages.** A message sent to a child thread from Studio doesn't carry the thread's sandbox ID, so it runs in the user's `main` sandbox.
- **No automatic resume.** After a restart, interrupted agents wait for Resume or a message. Mastra's durable agents could resume them from a checkpoint, but that API is being reworked.
- **Run tracking polls.** Mastra has no public event for a thread run starting or ending, so the tracker checks every 2 seconds; a run shorter than that may go unrecorded. With several server instances, another instance's running agents would show as interrupted.

## Testing so far

Tested with a scripted model, locally and on Modal. On Modal: file tools and commands shared the sandbox's folder, a child in a new sandbox got an empty folder and its report reached the parent, files survived the VM being replaced, and a second user's folder was empty. 

The example tasks above were run with a real model on Modal and behaved as described: the shared-sandbox example cloned `slugify`, its two children ran `xo` and the tests (84 passing) and reported, and the parent combined them; the own-sandbox example's child got its own folder with `fib.js` while the parent's held `notes.txt`; and the mid-task message made the counting agent stop at 5.

Through the web app with a real model (Claude Sonnet 5.5; the early runs went through the Gateway) on Modal: a task wrote a file, started a child in a new sandbox, and the child's report arrived live and woke the parent; a message sent from the app reached a child through `message_agent`; the files panel listed and opened the sandbox's files; Close moved a task to *Closed*; Delete removed a task, its child, and the child's sandbox files while keeping other sandboxes. A crash test killed the server while a parent and its child were running: after restart both showed as interrupted, Resume made the child rerun its command and report, the report woke the parent, and the parent read the saved report back with `wait_agent`.

Tested locally with a scripted model and two users: each ran in their own sandbox folder, and Bob couldn't use Alice's sandbox (through the request context or `start_agent`), message or read her threads, or create a sandbox with a made-up ID; a caller with no user got no sandbox, and the sixth extra sandbox was refused. Over HTTP on the built server, a request without a token got 401, Bob asking for Alice's threads got his own, and Bob reading Alice's thread got 403.

After moving to direct provider models and local storage, the mid-task example was rerun: every command and its result, the message, and the final reply were saved locally, and a child's report showed as a report card from stored history.
