# paperclip-git-graph

Paperclip plugin: commit graph plus per-branch ownership (issue, agent, pull request). TypeScript, React UI, esbuild, vitest, npm (no pnpm). Apache-2.0.

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

Manifest changes (capabilities, slots, config schema, database) need `plugin uninstall <key> --force` then `plugin install`; a rebuild alone only reloads worker and UI code. A stale worker after a rebuild: `plugin disable <key>` then `plugin enable <key>`.

## Docs

- `docs/paperclip.md`: what Paperclip is, where it lives on disk, objects, CLI calls, HTTP routes.
- `docs/sdk-reference.md`: the plugin SDK surface this repo uses, verified names.
- `docs/design-language.md`: tokens, signature, layout, presets, copy rules.

## Layout

- `src/shared/types.ts`: the contract between worker and UI. Add fields, never rename. Every UI data call passes `companyId`.
- `src/worker.ts`: `definePlugin` setup, data and action handlers, job, tool, events. Read this first.
- `src/worker/git.ts` (git subprocess calls), `cache.ts` (plugin database reads and writes), `ownership.ts` (branch to issue, agent, PR), `activity.ts` (agent cards, issue progress), `live.ts` (run events, stream, events table), `config.ts` (defaults over host config), `fs.ts` (repo picker), `github-auth.ts` (gh CLI or secret).
- `migrations/`: plugin database namespace schema. New schema changes go in a new numbered file.
- `src/graph/layout.ts`: original lane layout, no external code.
- `src/theme/`: host token map, presets, agent hue. `src/ui/theme.ts` holds the base CSS.
- `src/ui/App.tsx` (tab shell, live or polling), `GraphPage.tsx`, `Welcome.tsx`, `tabs/`, `SummaryWidget.tsx`.
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

## Host facts (Paperclip 2026.831.1)

- Company config reads as `null` until the settings form is saved once; the host form does not prefill schema defaults. `resolveConfig` applies defaults.
- `GET /api/plugins/:id/bridge/stream/:channel` returns 501 on this build; the UI polls `meta` every 20 s instead.
- Data routes wrap params: `params` is the object handlers receive, `companyId` also sits at the top level.
- GitHub needs a `User-Agent` header or it answers 403.
- The plugin database namespace is `plugin_git_graph_<hash>`; the host validates every statement and only allows writes inside it.

## Open items

- Owner chips overlap the author column below about 1300 px width.
- Events table is pruned to 2000 rows per company; nothing archives older rows.
- Lane connectors approximate agent colour from the row's commit, not the exact lane owner.
