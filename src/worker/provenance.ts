import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CommitProvenance } from "../shared/types.js";

const READ_CAP = 5000;

export interface FinishedRun {
  agentId: string;
  agentName?: string;
  runId?: string;
  at: string;
}

const finishedRuns = new Map<string, FinishedRun[]>();

export function noteFinishedRun(companyId: string, run: FinishedRun): void {
  finishedRuns.set(companyId, [...(finishedRuns.get(companyId) ?? []), run]);
}

export function takeFinishedRuns(companyId: string): FinishedRun[] {
  const runs = finishedRuns.get(companyId) ?? [];
  finishedRuns.delete(companyId);
  return runs;
}

// Tips that moved are credited only when exactly one agent finished since the last refresh; overlapping agents stay unknown.
export function attributeMovedTips(
  runs: FinishedRun[],
  oldRefs: Map<string, string>,
  newRefs: Map<string, string>
): Map<string, CommitProvenance> {
  const out = new Map<string, CommitProvenance>();
  const agents = new Set(runs.map((run) => run.agentId));
  if (agents.size !== 1) return out;
  const run = runs[runs.length - 1];
  for (const [name, sha] of newRefs) {
    if (oldRefs.get(name) === sha) continue;
    out.set(sha, { agentId: run.agentId, agentName: run.agentName, runId: run.runId, at: run.at });
  }
  return out;
}

export async function recordProvenance(ctx: PluginContext, companyId: string, entries: Map<string, CommitProvenance>): Promise<void> {
  const namespace = ctx.db.namespace;
  const existing = await readProvenance(ctx, companyId);
  const fresh = [...entries].filter(([sha]) => !existing[sha]);
  if (fresh.length === 0) return;
  const rows: string[] = [];
  const params: unknown[] = [];
  for (const [sha, entry] of fresh) {
    const base = params.length;
    rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(companyId, sha, entry.agentId, entry.agentName ?? null, entry.runId ?? null, entry.at);
  }
  await ctx.db.execute(
    `INSERT INTO ${namespace}.commit_provenance (company_id, sha, agent_id, agent_name, run_id, at) VALUES ${rows.join(", ")} ON CONFLICT (company_id, sha) DO NOTHING`,
    params
  );
}

interface ProvenanceRow {
  sha: string;
  agent_id: string;
  agent_name: string | null;
  run_id: string | null;
  at: string;
}

export async function readProvenance(ctx: PluginContext, companyId: string): Promise<Record<string, CommitProvenance>> {
  const rows = await ctx.db
    .query<ProvenanceRow>(
      `SELECT sha, agent_id, agent_name, run_id, at FROM ${ctx.db.namespace}.commit_provenance WHERE company_id = $1 ORDER BY at DESC LIMIT ${READ_CAP}`,
      [companyId]
    )
    .catch(() => [] as ProvenanceRow[]);
  const out: Record<string, CommitProvenance> = {};
  for (const row of rows) {
    out[row.sha] = { agentId: row.agent_id, agentName: row.agent_name ?? undefined, runId: row.run_id ?? undefined, at: String(row.at) };
  }
  return out;
}
