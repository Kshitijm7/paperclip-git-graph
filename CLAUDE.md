# paperclip-git-graph

Paperclip plugin: commit graph, agent run timeline, issue progress and activity feed, with per-branch ownership (issue, agent, pull request) and per-commit provenance (which agent run moved a branch to that commit). TypeScript, React UI, esbuild, vitest, npm (no pnpm). Apache-2.0. CI (`.github/workflows/ci.yml`) runs typecheck, test and build on Linux and Windows, Node 20 and 22.

## Commands

```bash
npm install
npm run build        # dist/worker.js, dist/manifest.js, dist/ui/
npm run typecheck    # tsc --noEmit, must be clean before any commit
npm test             # vitest, all files
npx vitest run tests/<file>.spec.ts
```

Install into a running Paperclip (local_trusted, no auth):

```bash
node <paperclip>/node_modules/paperclipai/dist/index.js plugin install <this dir> --api-base http://127.0.0.1:3100
```

Manifest changes (capabilities, slots, config schema, database, `coreReadTables`) need `plugin uninstall <key>` then `plugin install`. Do not pass `--force` unless a purge is intended: it deletes plugin state, config, the repository binding and the database namespace. New migrations also apply on a plain uninstall and install. A rebuild alone only reloads worker and UI code; for a stale worker run `plugin disable <key>` then `plugin enable <key>`.

## Docs

- `docs/paperclip.md`: what Paperclip is, where it lives on disk, objects, CLI calls, HTTP routes.
- `docs/sdk-reference.md`: the plugin SDK surface this repo uses, verified names.
- `docs/design-language.md`: tokens, signature, layout, presets, copy rules.

## Layout

- `src/shared/types.ts`: the contract between worker and UI. Add fields, never rename. Every UI data call passes `companyId`.
- `src/worker.ts`: `definePlugin` setup, data and action handlers, job, tool, events. Read this first.
- `src/worker/git.ts` (git subprocess calls, remote and default branch detection), `cache.ts` (plugin database reads and writes), `ownership.ts` (branch to issue, agent, PR), `provenance.ts` (commit to agent run records), `activity.ts` (agent cards, issue progress, run spans from `heartbeat_runs`), `live.ts` (run events, stream, events table), `config.ts` (defaults and derived values over host config), `fs.ts` (repo picker), `github-auth.ts` (gh CLI or secret).
- `migrations/`: plugin database namespace schema. New schema changes go in a new numbered file.
- `src/graph/layout.ts`: original lane layout, no external code.
- `src/theme/`: host token map, presets, agent hue. `src/ui/theme.ts` holds the base CSS.
- `src/ui/App.tsx` (tab shell, live or polling, compare branch), `GraphPage.tsx` (one SVG overlay for the visible rows), `commit-owner.ts`, `Welcome.tsx`, `SummaryWidget.tsx` (cached in localStorage, refreshes in the background).
- `src/ui/tabs/`: `AgentsTab.tsx` (run timeline, needs attention, team pulse), `ProgressTab.tsx`, `ActivityTab.tsx`, `helpers.ts` (labels, tones, badges), `Pill.tsx`, `CompareSelect.tsx`.
- `docs/screenshots/`: README images. Recapture with made-up names and issue keys; never commit a screenshot with real people, repos or task titles.
- `tests/`: one spec per module; `tests/fake-db.ts` is the in-memory stand-in for `ctx.db`.
- `.scratch/`: gitignored notes and screenshots for design work.

## Rules for agents working here

1. Use the Paperclip host services before writing anything custom: `ctx.db` namespace for tables, `ctx.entities` for per-company records, `ctx.state` only for small values (timestamps, debounce), `ctx.activity.log`, `ctx.metrics.write`, `ctx.jobs`, `ctx.streams`, `ctx.tools`. SDK reference: `node_modules/@paperclipai/plugin-sdk/README.md` and `dist/types.d.ts`.
2. Data handlers must return fast. Anything that calls GitHub, scans comments, or spawns git per branch belongs in `refreshOwnership` or a job, never in `snapshot`, `status`, or `activity`.
3. One git subprocess per request where possible. Prefer `for-each-ref` with format fields over loops over branches.
4. Surfaces, text, and borders come from host CSS variables (`--background`, `--foreground`, `--border`, `--muted-foreground`, `--card`, `--accent`, `.dark`). No hex greys, no plugin background. Presets change only density, chip style, and lane colours.
5. No new runtime dependencies. No comments except for a fact the code cannot carry. No em dashes in prose. Plain sentences in UI copy: buttons say what happens.
6. Verify before claiming: paste `npm run typecheck` and `npm test` output. Live checks use `POST /api/plugins/<key>/data/<key>` with body `{"companyId": C, "params": {...}}` and `POST .../actions/<key>` with the same shape. Tag anything unverified `[uncertain]`.
7. Do not commit unless asked. Never push to `main` from a subagent.
8. Nothing project-specific in code. Branch names, remotes, issue prefixes, thresholds and windows are settings or derived (see Settings below). Tests and docs use neutral examples such as `ABC-12` and `/path/to/repo`.

## Settings

Empty strings mean "derive it". `resolveConfig` fills derived values.

| Key | Default | Derived from when empty |
|---|---|---|
| `trunk` | `""` | `refs/remotes/<remote>/HEAD`, else the checked-out branch, else the first local branch. The UI can override it per viewer with the Compare with dropdown (`trunk` data param). |
| `remote` | `""` | `origin` if present, else the first `git remote`. |
| `branchPattern` | `""` | `(?<issue>PREFIX-\d+)` from the company's `issuePrefix`, else `(?<issue>[A-Z][A-Z0-9]+-\d+)`. |
| `farBehindCommits` | 20 | Needs attention threshold. |
| `staleDays` | 3 | Needs attention threshold. |
| `hungRunMinutes` | 60 | Failed runs longer than this draw as a thin line. |
| `timelineHours` | 24 | Agents timeline window, max 168. |
| `githubAuth`, `githubToken`, `githubRepo`, `fetchIntervalMinutes`, `commitLimit`, `theme` | see manifest | |

## Host facts (Paperclip 2026.831.1)

- Company config reads as `null` until the settings form is saved once; the host form does not prefill schema defaults. `resolveConfig` applies defaults.
- `GET /api/plugins/:id/bridge/stream/:channel` returns 501 on this build; the UI polls `meta` every 20 s instead.
- Data routes wrap params: `params` is the object handlers receive, `companyId` also sits at the top level.
- GitHub needs a `User-Agent` header or it answers 403.
- The plugin database namespace is `plugin_git_graph_<hash>`; the host validates every statement and only allows writes inside it. Reads of `public.heartbeat_runs` work because the manifest lists it in `coreReadTables`.
- The host SQL layer expands a JS array param into `(a, b)`. Pass `text[]` values as a Postgres literal (`pgTextArray` in `cache.ts`) or an empty array becomes `()` and the whole insert fails.
- `git for-each-ref --format` takes `%1f` for a unit separator; `%x1f` is only understood by `git log` and prints literally in `for-each-ref`.
- `heartbeat_runs` has runs that stay open for hours and then get marked `failed` or `timed_out`. Treat long failures as hung, not as busy time.
- GitHub's README image cache keys on the URL. Replacing a screenshot at the same path keeps showing the old one for a while; use a new filename.

## Open items

- Events table is pruned to 2000 rows per company; nothing archives older rows. The Agents timeline does not depend on it (it reads `heartbeat_runs`).
- Commit provenance is inferred from timing: a branch tip that moves while exactly one agent finished a run is credited to that run. Overlapping runs record nothing.
- The graph column width follows the lanes on screen, so the description column shifts a little while scrolling past busy history.
