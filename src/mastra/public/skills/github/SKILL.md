---
name: github
description: Use when a task involves a GitHub repository beyond plain git, such as reading issues or pull requests, checking CI runs, or reading the logs of a failed workflow. Drives the GitHub CLI (gh) in the sandbox.
---

# GitHub with the gh CLI

`gh` is installed in the sandbox and signs in with the `GH_TOKEN` environment variable. Never print, echo, or write that variable.

`gh` refuses to run without a token. Check first with `test -n "$GH_TOKEN"`. If it's empty, read public repositories through the REST API instead, for example `curl -s "https://api.github.com/repos/<owner>/<repo>/issues?state=open&sort=updated&per_page=10"` (that list also includes pull requests: skip items with a `pull_request` field), and say in your answer that no token was set.

Run `gh` from inside a clone (for example `cwd: "/mnt/work/<repo>"`) so it picks the repository from the git remote, or pass `--repo owner/name`.

## Read issues and pull requests

```bash
gh issue list --state open --limit 20 --json number,title,labels,updatedAt
gh issue view <number> --json title,body,comments
gh pr list --state open --limit 20 --json number,title,author,headRefName
gh pr view <number> --json title,body,files,reviews
gh pr diff <number> | head -n 300
```

## Check CI

```bash
gh run list --limit 10 --json databaseId,workflowName,status,conclusion,headBranch,url
gh run view <databaseId> --json jobs \
  --jq '.jobs[] | select(.conclusion == "failure") | {name, steps: [.steps[] | select(.conclusion == "failure") | .name]}'
gh run view <databaseId> --log-failed | tail -n 200
```

Always pipe logs through `tail` or `head`; full logs fill the context window. Look for the first error (an assertion, `Error:`, `FAIL`, a non-zero exit), not the last line.

## Don't

Unless the task asks for it explicitly:

- Create, close, or comment on issues and pull requests.
- Re-run, cancel, or delete workflow runs.
- Call `gh api` with a method other than GET.
