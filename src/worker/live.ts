import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { STREAM_CHANNEL } from "../shared/types.js";
import type { CachedSnapshotMeta, GitEvent, PullRequestInfo, RepoChangedEvent } from "../shared/types.js";
import { readRefs } from "./git.js";

const DEBOUNCE_MS = 5000;
const EVENTS_CAP = 200;

const openedChannels = new Set<string>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function lastRunsKey(companyId: string) {
  return { scopeKind: "company" as const, scopeId: companyId, stateKey: "last-runs" };
}

export type LastRuns = Record<string, { at: string; status: string }>;

export function ensureStream(ctx: PluginContext, companyId: string): void {
  if (openedChannels.has(companyId)) return;
  ctx.streams.open(STREAM_CHANNEL, companyId);
  openedChannels.add(companyId);
}

export function emitRepoChanged(
  ctx: PluginContext,
  companyId: string,
  reason: RepoChangedEvent["reason"],
  meta: CachedSnapshotMeta
): void {
  ensureStream(ctx, companyId);
  const event: RepoChangedEvent = { type: "repo.changed", companyId, reason, meta };
  ctx.streams.emit(STREAM_CHANNEL, event);
}

interface EventRow {
  at: string;
  kind: GitEvent["kind"];
  branch: string | null;
  sha: string | null;
  agent_id: string | null;
  agent_name: string | null;
  issue_identifier: string | null;
  pr_number: number | null;
  summary: string;
}

function rowToEvent(row: EventRow, idx: number): GitEvent {
  return {
    id: `${row.kind}:${row.sha ?? row.pr_number ?? row.agent_id ?? idx}:${row.at}`,
    at: row.at,
    kind: row.kind,
    branch: row.branch ?? undefined,
    sha: row.sha ?? undefined,
    agentId: row.agent_id ?? undefined,
    agentName: row.agent_name ?? undefined,
    issueIdentifier: row.issue_identifier ?? undefined,
    prNumber: row.pr_number ?? undefined,
    summary: row.summary
  };
}

export async function readEvents(ctx: PluginContext, companyId: string): Promise<GitEvent[]> {
  const namespace = ctx.db.namespace;
  const rows = await ctx.db.query<EventRow>(
    `SELECT at, kind, branch, sha, agent_id, agent_name, issue_identifier, pr_number, summary FROM ${namespace}.events WHERE company_id = $1 ORDER BY at DESC LIMIT ${EVENTS_CAP}`,
    [companyId]
  );
  return rows.map((row, idx) => rowToEvent(row, idx));
}

export async function appendEvents(ctx: PluginContext, companyId: string, events: GitEvent[]): Promise<GitEvent[]> {
  if (events.length === 0) return readEvents(ctx, companyId);
  const namespace = ctx.db.namespace;
  const params: unknown[] = [];
  const rows: string[] = [];
  let n = 1;
  for (const event of events) {
    rows.push(`($${n}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}, $${n + 9})`);
    params.push(
      companyId,
      event.at,
      event.kind,
      event.branch ?? null,
      event.sha ?? null,
      event.agentId ?? null,
      event.agentName ?? null,
      event.issueIdentifier ?? null,
      event.prNumber ?? null,
      event.summary
    );
    n += 10;
  }
  await ctx.db.execute(
    `INSERT INTO ${namespace}.events (company_id, at, kind, branch, sha, agent_id, agent_name, issue_identifier, pr_number, summary) VALUES ${rows.join(", ")}`,
    params
  );
  await ctx.db.execute(
    `DELETE FROM ${namespace}.events WHERE company_id = $1 AND id NOT IN (SELECT id FROM ${namespace}.events WHERE company_id = $1 ORDER BY at DESC LIMIT ${EVENTS_CAP})`,
    [companyId]
  );
  return readEvents(ctx, companyId);
}

export async function readLastRuns(ctx: PluginContext, companyId: string): Promise<LastRuns> {
  return ((await ctx.state.get(lastRunsKey(companyId))) as LastRuns | null) ?? {};
}

export async function recordLastRun(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  at: string,
  status: string
): Promise<void> {
  const runs = await readLastRuns(ctx, companyId);
  runs[agentId] = { at, status };
  await ctx.state.set(lastRunsKey(companyId), runs);
}

export async function refsToMap(cwd: string): Promise<Map<string, string>> {
  const refs = await readRefs(cwd);
  return new Map(refs.map((ref) => [ref.name, ref.sha]));
}

export function diffRefEvents(oldRefs: Map<string, string>, newRefs: Map<string, string>): GitEvent[] {
  const events: GitEvent[] = [];
  const now = new Date().toISOString();
  for (const [name, sha] of newRefs) {
    const prevSha = oldRefs.get(name);
    if (prevSha === undefined) {
      events.push({ id: `branch.created:${name}:${now}`, at: now, kind: "branch.created", branch: name, sha, summary: `${name} created` });
    } else if (prevSha !== sha) {
      events.push({ id: `branch.updated:${name}:${now}`, at: now, kind: "branch.updated", branch: name, sha, summary: `${name} updated` });
    }
  }
  for (const [name, sha] of oldRefs) {
    if (!newRefs.has(name)) {
      events.push({ id: `branch.deleted:${name}:${now}`, at: now, kind: "branch.deleted", branch: name, sha, summary: `${name} deleted` });
    }
  }
  return events;
}

export function diffPrEvents(oldPrs: PullRequestInfo[], newPrs: PullRequestInfo[]): GitEvent[] {
  const events: GitEvent[] = [];
  const now = new Date().toISOString();
  const oldByNumber = new Map(oldPrs.map((pr) => [pr.number, pr]));
  for (const pr of newPrs) {
    const prev = oldByNumber.get(pr.number);
    if (!prev) {
      if (pr.state === "open" || pr.state === "draft") {
        events.push({ id: `pr.opened:${pr.number}:${now}`, at: now, kind: "pr.opened", prNumber: pr.number, summary: `PR #${pr.number} opened` });
      }
      continue;
    }
    if (prev.state !== pr.state) {
      if (pr.state === "merged") {
        events.push({ id: `pr.merged:${pr.number}:${now}`, at: now, kind: "pr.merged", prNumber: pr.number, summary: `PR #${pr.number} merged` });
      } else if (pr.state === "closed") {
        events.push({ id: `pr.closed:${pr.number}:${now}`, at: now, kind: "pr.closed", prNumber: pr.number, summary: `PR #${pr.number} closed` });
      }
    }
  }
  return events;
}

function agentInfoFromPayload(event: PluginEvent): { agentId?: string; agentName?: string; runId?: string } {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const agentId = typeof payload.agentId === "string" ? payload.agentId : event.entityType === "agent" ? event.entityId : undefined;
  const agentName = typeof payload.agentName === "string" ? payload.agentName : undefined;
  const runId = typeof payload.runId === "string" ? payload.runId : undefined;
  return { agentId, agentName, runId };
}

export interface RegisterLiveUpdatesOptions {
  onRefsChanged: (companyId: string) => Promise<void>;
}

// [uncertain] PLUGIN_EVENT_TYPES confirms these three run event strings exist; the exact
// payload shape (agentId/agentName/runId) is not typed, so fields are read defensively.
export function registerLiveUpdates(ctx: PluginContext, opts: RegisterLiveUpdatesOptions): void {
  const handler = (kind: "run.started" | "run.finished" | "run.failed") => async (event: PluginEvent) => {
    const companyId = event.companyId;
    if (!companyId) return;
    const { agentId, agentName } = agentInfoFromPayload(event);
    if (agentId) {
      await recordLastRun(ctx, companyId, agentId, event.occurredAt, kind);
    }
    if (kind !== "run.started") {
      await appendEvents(ctx, companyId, [
        {
          id: `${kind}:${agentId ?? "unknown"}:${event.occurredAt}`,
          at: event.occurredAt,
          kind,
          agentId,
          agentName,
          summary: `${agentName ?? agentId ?? "An agent"} ${kind === "run.finished" ? "finished a run" : "failed a run"}`
        }
      ]);
    }

    const existing = debounceTimers.get(companyId);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      companyId,
      setTimeout(() => {
        debounceTimers.delete(companyId);
        opts.onRefsChanged(companyId).catch((error) => ctx.logger.warn("Live refresh after agent run failed", { companyId, message: (error as Error).message }));
      }, DEBOUNCE_MS)
    );
  };

  ctx.events.on("agent.run.started", handler("run.started"));
  ctx.events.on("agent.run.finished", handler("run.finished"));
  ctx.events.on("agent.run.failed", handler("run.failed"));
}
