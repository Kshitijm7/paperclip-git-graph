import type { CSSProperties } from "react";
import { useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { ActivityData, AgentGitCard, AgentRunSpan, GitEvent } from "../../shared/types.js";
import { relativeDate } from "../theme.js";
import { agentHueColor, agentStatusBadge, prBadge, sortAgents, TONE } from "./helpers.js";
import { CompareSelect } from "./CompareSelect.js";
import { Pill } from "./Pill.js";

interface AgentsTabProps {
  activity: ActivityData | null;
  loading: boolean;
  onCompareChange: (branch: string) => void;
}

const HOUR_MS = 60 * 60 * 1000;

interface Limits {
  farBehind: number;
  staleMs: number;
  hungMs: number;
  windowMs: number;
  hours: number;
}

function limitsFrom(activity: ActivityData | null): Limits {
  const t = activity?.thresholds;
  const hours = t?.timelineHours ?? 24;
  return {
    farBehind: t?.farBehindCommits ?? 20,
    staleMs: (t?.staleDays ?? 3) * 24 * HOUR_MS,
    hungMs: (t?.hungRunMinutes ?? 60) * 60 * 1000,
    windowMs: hours * HOUR_MS,
    hours,
  };
}

function windowLabel(hours: number): string {
  return hours % 24 === 0 && hours > 24 ? `${hours / 24} days` : `${hours} hours`;
}
const ROW = "minmax(0, 34%) minmax(0, 1fr)";

function runColor(status: string): string {
  if (status === "running" || status === "queued") return TONE.blue;
  if (status === "succeeded") return TONE.green;
  if (status === "failed" || status === "timed_out") return TONE.red;
  return TONE.muted;
}

function runLabel(run: AgentRunSpan): string {
  const start = new Date(run.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const end = run.end ? new Date(run.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now";
  return `${run.status.replace("_", " ")}: ${start} to ${end}`;
}

interface AgentStats {
  runs: AgentRunSpan[];
  failed: number;
  busyPct: number;
  lastFailed: boolean;
}

function isFailure(status: string): boolean {
  return status === "failed" || status === "timed_out";
}

function statsFor(runs: AgentRunSpan[], windowStart: number, now: number, windowMs: number): AgentStats {
  const spans = runs
    .filter((run) => !isFailure(run.status))
    .map((run) => [Math.max(windowStart, new Date(run.start).getTime()), run.end ? new Date(run.end).getTime() : now] as const)
    .sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let cursor = windowStart;
  for (const [start, end] of spans) {
    const from = Math.max(start, cursor);
    if (end > from) busy += end - from;
    cursor = Math.max(cursor, end);
  }
  const finished = runs.filter((run) => run.end).sort((a, b) => new Date(a.end!).getTime() - new Date(b.end!).getTime());
  const last = finished[finished.length - 1];
  return {
    runs,
    failed: runs.filter((run) => isFailure(run.status)).length,
    busyPct: Math.min(100, Math.round((busy / windowMs) * 100)),
    lastFailed: Boolean(last && isFailure(last.status)),
  };
}

function attentionFor(agent: AgentGitCard, stats: AgentStats, now: number, limits: Limits): string[] {
  const out: string[] = [];
  if (stats.lastFailed) out.push("last run failed");
  if ((agent.behindTrunk ?? 0) >= limits.farBehind) out.push(`${agent.behindTrunk} behind, merge conflicts likely`);
  if (agent.pr?.state === "open" && agent.pr.reviewers.length === 0) out.push(`PR #${agent.pr.number} has no reviewer`);
  if (agent.branch && agent.lastCommitAt && now - new Date(agent.lastCommitAt).getTime() > limits.staleMs) out.push(`no commit for ${Math.round(limits.staleMs / (24 * HOUR_MS))}+ days`);
  return out;
}

export function AgentsTab({ activity, loading, onCompareChange }: AgentsTabProps) {
  const hostNavigation = useHostNavigation();
  if (loading && !activity) return <div style={{ padding: 16 }} className="gg-dim">Loading agents...</div>;

  const agents = sortAgents(activity?.agents ?? []);
  const trunk = activity?.trunk ?? "trunk";
  if (agents.length === 0)
    return (
      <div style={{ padding: 16 }} className="gg-dim">
        No agent has pushed to this repo yet. Assign an issue and the branch shows here.
      </div>
    );

  const now = Date.now();
  const limits = limitsFrom(activity);
  const windowStart = now - limits.windowMs;
  const pos = (iso: string) => Math.max(0, Math.min(100, ((new Date(iso).getTime() - windowStart) / limits.windowMs) * 100));
  const runsByAgent = new Map<string, AgentRunSpan[]>();
  for (const run of activity?.runs ?? []) runsByAgent.set(run.agentId, [...(runsByAgent.get(run.agentId) ?? []), run]);
  const commitEvents = (activity?.events ?? []).filter(
    (e): e is GitEvent & { branch: string } => e.kind === "branch.updated" && Boolean(e.branch) && new Date(e.at).getTime() >= windowStart,
  );

  const rows = agents.map((agent) => {
    const stats = statsFor(runsByAgent.get(agent.agentId) ?? [], windowStart, now, limits.windowMs);
    return { agent, stats, attention: attentionFor(agent, stats, now, limits) };
  });
  const flagged = rows.filter((row) => row.attention.length > 0);
  const maxAhead = Math.max(1, ...agents.map((a) => a.aheadOfTrunk ?? 0));
  const maxBehind = Math.max(1, ...agents.map((a) => a.behindTrunk ?? 0));

  const hourly = Array.from({ length: limits.hours }, () => 0);
  for (const run of activity?.runs ?? []) {
    const idx = Math.floor((new Date(run.start).getTime() - windowStart) / (60 * 60 * 1000));
    if (idx >= 0 && idx < limits.hours) hourly[idx] += 1;
  }
  const maxHourly = Math.max(1, ...hourly);
  const tickFormat: Intl.DateTimeFormatOptions = limits.hours > 24 ? { weekday: "short", hour: "numeric" } : { hour: "numeric" };
  const ticks = [0, 1, 2, 3].map((q) => ({
    left: q * 25,
    label: new Date(windowStart + (q * limits.windowMs) / 4).toLocaleString([], tickFormat),
  }));

  return (
    <div style={{ overflowY: "auto", overflowX: "hidden", height: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--gg-border)" }}>
        <CompareSelect trunk={trunk} branches={activity?.branches ?? []} onChange={onCompareChange} />
        <span className="gg-dim" style={{ fontSize: 12 }}>Last {windowLabel(limits.hours)} of runs from Paperclip</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
          <Legend color={TONE.green} label="Succeeded" />
          <Legend color={TONE.red} label={`Failed (thin line: hung over ${Math.round(limits.hungMs / 60000)} min)`} />
          <Legend color={TONE.blue} label="Running" />
          <Legend color={TONE.amber} label="New commits" dot />
        </span>
      </div>

      {flagged.length > 0 && (
        <div style={{ margin: "10px 14px", padding: "8px 12px", borderRadius: 8, background: `color-mix(in oklch, ${TONE.amber} 10%, transparent)`, border: `1px solid color-mix(in oklch, ${TONE.amber} 35%, transparent)` }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Needs attention ({flagged.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12.5 }}>
            {flagged.map(({ agent, attention }) => (
              <span key={agent.agentId} className="gg-ell" style={{ maxWidth: "100%" }} title={attention.join(", ")}>
                <strong>{agent.agentName}</strong>: {attention.join(", ")}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: ROW, columnGap: 16, padding: "6px 14px", borderBottom: "1px solid var(--gg-border)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--gg-fg-dim)" }}>
        <span>Agent, branch and PR</span>
        <span style={{ position: "relative", height: 14 }}>
          {ticks.map((t) => (
            <span key={t.left} style={{ position: "absolute", left: `${t.left}%` }}>{t.label}</span>
          ))}
          <span style={{ position: "absolute", right: 0 }}>Now</span>
        </span>
      </div>

      {rows.map(({ agent, stats, attention }) => {
        const status = agentStatusBadge(agent.agentStatus);
        const ahead = agent.aheadOfTrunk ?? 0;
        const behind = agent.behindTrunk ?? 0;
        const marks = agent.branch ? commitEvents.filter((e) => e.branch === agent.branch) : [];
        return (
          <div key={agent.agentId} style={{ display: "grid", gridTemplateColumns: ROW, columnGap: 16, alignItems: "center", padding: "8px 14px", borderBottom: "1px solid color-mix(in oklch, var(--gg-border) 60%, transparent)" }}>
            <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ flex: "0 0 8px", height: 8, borderRadius: "50%", background: agentHueColor(agent.agentId) }} />
                <span className="gg-ell" style={{ fontWeight: 600, minWidth: 0 }} title={agent.agentName}>{agent.agentName}</span>
                {attention.length > 0 && <span title={attention.join(", ")} style={{ color: TONE.amber }}>!</span>}
                <span style={{ marginLeft: "auto", flexShrink: 0 }}><Pill badge={status} /></span>
              </div>
              {agent.branch ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 12 }}>
                  {agent.issueIdentifier ? (
                    <a className="gg-link gg-mono" style={{ flexShrink: 0 }} title={agent.issueTitle} {...hostNavigation.linkProps(`/issues/${agent.issueIdentifier}`)}>{agent.issueIdentifier}</a>
                  ) : (
                    <span className="gg-mono gg-ell" style={{ minWidth: 0 }} title={agent.branch}>{agent.branch}</span>
                  )}
                  <span
                    title={`${ahead} commits not in ${trunk}, ${behind} commits in ${trunk} not on this branch`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                  >
                    <span style={{ display: "inline-flex", justifyContent: "flex-end", width: 34 }}>
                      <span style={{ height: 6, borderRadius: 3, width: `${Math.max(ahead ? 8 : 0, (ahead / maxAhead) * 100)}%`, background: TONE.green }} />
                    </span>
                    <span style={{ width: 1, height: 10, background: "var(--gg-fg-dim)" }} />
                    <span style={{ display: "inline-flex", width: 34 }}>
                      <span style={{ height: 6, borderRadius: 3, width: `${Math.max(behind ? 8 : 0, (behind / maxBehind) * 100)}%`, background: TONE.amber }} />
                    </span>
                    <span className="gg-mono" style={{ fontSize: 11 }}>
                      <span className="gg-num-ahead">{ahead}↑</span> <span className={behind >= limits.farBehind ? "gg-num-behind" : "gg-dim"}>{behind}↓</span>
                    </span>
                  </span>
                  {agent.pr ? (
                    <a href={agent.pr.url} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", flexShrink: 0, color: "inherit", textDecoration: "none" }} title={agent.pr.title}>
                      <Pill badge={{ ...prBadge(agent.pr.state), label: `#${agent.pr.number} ${prBadge(agent.pr.state).label}` }} />
                    </a>
                  ) : (
                    <span className="gg-dim" style={{ marginLeft: "auto", flexShrink: 0 }}>No PR</span>
                  )}
                </div>
              ) : (
                <span className="gg-dim" style={{ fontSize: 12 }}>No branch yet</span>
              )}
              <div className="gg-dim gg-ell" style={{ fontSize: 11.5 }}>
                {stats.runs.length} runs{stats.failed ? ` · ${stats.failed} failed` : ""} · busy {stats.busyPct}% of the window
                {agent.lastCommitAt ? ` · last commit ${relativeDate(agent.lastCommitAt)}` : ""}
              </div>
            </div>

            <div style={{ position: "relative", height: 26, minWidth: 0, borderRadius: 4, background: "color-mix(in oklch, var(--gg-border) 35%, transparent)", overflow: "hidden" }}>
              {ticks.slice(1).map((t) => (
                <span key={t.left} style={{ position: "absolute", left: `${t.left}%`, top: 0, bottom: 0, width: 1, background: "var(--gg-border)" }} />
              ))}
              {[...stats.runs]
                .sort((a, b) => Number(!isFailure(a.status)) - Number(!isFailure(b.status)))
                .map((run, i) => {
                  const left = pos(run.start);
                  const right = run.end ? pos(run.end) : 100;
                  const long = isFailure(run.status) && run.end && new Date(run.end).getTime() - new Date(run.start).getTime() > limits.hungMs;
                  if (long)
                    return (
                      <span key={i} title={`${runLabel(run)} (ran over ${Math.round(limits.hungMs / 60000)} minutes before it was marked ${run.status.replace("_", " ")})`}>
                        <span style={{ position: "absolute", top: 12, height: 2, left: `${left}%`, width: `${right - left}%`, background: TONE.red, opacity: 0.5 }} />
                        <span style={{ position: "absolute", top: 5, height: 16, left: `calc(${right}% - 3px)`, width: 3, borderRadius: 2, background: TONE.red }} />
                      </span>
                    );
                  return (
                    <span
                      key={i}
                      title={runLabel(run)}
                      style={{ position: "absolute", top: 6, height: 14, left: `${left}%`, width: `max(3px, ${right - left}%)`, borderRadius: 3, background: runColor(run.status) }}
                    />
                  );
                })}
              {marks.map((e) => (
                <span
                  key={e.id}
                  title={`New commits on ${e.branch}, ${relativeDate(e.at)}`}
                  style={{ position: "absolute", top: 2, left: `calc(${pos(e.at)}% - 3px)`, width: 6, height: 6, borderRadius: "50%", background: TONE.amber }}
                />
              ))}
              {stats.runs.length === 0 && (
                <span className="gg-dim" style={{ position: "absolute", left: 8, top: 5, fontSize: 11.5 }}>No runs in the last {windowLabel(limits.hours)}</span>
              )}
            </div>
          </div>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: ROW, columnGap: 16, alignItems: "end", padding: "10px 14px 14px" }}>
        <div>
          <div style={{ fontWeight: 600 }}>Team pulse</div>
          <div className="gg-dim" style={{ fontSize: 11.5 }}>Runs started per hour, all agents</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36, minWidth: 0 }}>
          {hourly.map((count, h) => (
            <span
              key={h}
              title={`${count} runs started ${new Date(windowStart + h * 3600000).toLocaleTimeString([], { hour: "numeric" })}`}
              style={{ flex: 1, minWidth: 0, height: `${Math.max(count ? 12 : 4, (count / maxHourly) * 100)}%`, borderRadius: 2, background: count ? TONE.blue : "var(--gg-border)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, dot }: { color: string; label: string; dot?: boolean }) {
  const swatch: CSSProperties = dot
    ? { width: 7, height: 7, borderRadius: "50%", background: color }
    : { width: 14, height: 7, borderRadius: 2, background: color };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={swatch} />
      {label}
    </span>
  );
}
