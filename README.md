# paperclip-git-graph

A commit graph rendered inside [Paperclip](https://github.com/paperclipai/paperclip), the AI-agent company orchestrator. For every branch it shows who is working on it: the Paperclip issue and assigned agent, the GitHub pull request, and any branch names mentioned in issue run logs.

## What

- Commit graph with branch lanes, worktrees, tags, remote branches, and HEAD, laid out the way SourceGit draws them.
- Per-branch ownership panel: issue key parsed from the branch name (default pattern `agent/{ISSUE-KEY}-slug`), the agent assigned to that issue, the linked GitHub PR (state, author, reviewers, checks), and branch mentions found in issue run logs.
- A dashboard widget, "who is on what", summarizing branch ownership across the bound repo.

## Screenshot

_placeholder: add a screenshot of the graph page and the dashboard widget here._

## Install

Requires Node 20+, git on PATH, and Paperclip 2026.831 or newer (built against `@paperclipai/plugin-sdk` 2026.831.1).

Windows:

```powershell
scripts/install.ps1
```

POSIX:

```bash
scripts/install.sh
```

Each script clones or pulls the repo, runs `npm install`, builds with `npm run build`, and installs the plugin with `paperclipai plugin install <dir>`.

To update later:

```powershell
scripts/update.ps1
```

```bash
scripts/update.sh
```

Manual install, without the scripts:

```bash
npm install && npm run build && paperclipai plugin install .
```

## Bind a repo

The plugin declares a trusted local folder with key `repo`. Bind it once per company, either from the plugin's empty state in the UI, or from the CLI:

```powershell
scripts/bind-repo.ps1
```

```bash
scripts/bind-repo.sh
```

Or directly:

```bash
paperclipai plugin local-folder:set paperclip-git-graph repo -C <companyId> --payload-json '{"path":"C:\\abs\\path"}'
```

## Configure

| Setting | Default | Notes |
|---|---|---|
| `githubToken` | none | Secret reference. Optional; needed to read a private repo. Stored as a Paperclip secret ref, never logged. |
| `githubRepo` | auto-detected | `owner/name`. Left empty, it is read from the bound folder's `origin` remote. |
| `fetchIntervalMinutes` | 15 | How often the worker runs `git fetch` in the background. |
| `commitLimit` | 400 | Max commits loaded into the graph per query. |
| `branchPattern` | `agent/{ISSUE-KEY}-slug` shape | A regex with a named group `issue`, used to pull the issue identifier out of a branch name. |

## How ownership is resolved

For each branch, the worker collects ownership from up to three sources and merges them:

1. **branch-name**: the `issue` capture group from `branchPattern` matched against the branch name, resolved to a Paperclip issue and its assigned agent.
2. **github-pr**: a GitHub pull request whose head ref is that branch, with state, author, reviewers, and check status.
3. **run-log**: branch names mentioned in an issue's run logs, for branches that don't match `branchPattern` but were still touched by an agent run.

Each source is recorded separately, so a branch can show ownership even when only one of the three signals is present.

## Develop

```bash
npm run dev        # esbuild watch build; Paperclip reloads dist on change
npm test
npm run typecheck
```

## Security note

The worker runs `git` in the bound folder, and the plugin UI executes same-origin JavaScript inside Paperclip. Install this plugin only from a source you trust. The GitHub token, if set, is stored as a Paperclip secret reference and is never written to logs.

## License

Apache-2.0. See LICENSE and NOTICE.
