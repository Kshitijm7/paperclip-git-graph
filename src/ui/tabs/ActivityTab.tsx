import { useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { ActivityData, GitEvent, PullRequestInfo } from "../../shared/types.js";
import { EVENT_BADGE, dayLabel, groupByDay } from "./helpers.js";
import { Pill } from "./Pill.js";

interface ActivityTabProps {
  activity: ActivityData | null;
  loading: boolean;
  newEventIds: ReadonlySet<string>;
}

const COLUMNS = "minmax(56px, 0.5fr) minmax(0, 1fr) minmax(0, 2.6fr) minmax(0, 1.2fr) minmax(0, 1.2fr)";

function describe(event: GitEvent, agentName: string | undefined, pr: PullRequestInfo | undefined): string {
  const who = agentName ?? "An agent";
  switch (event.kind) {
    case "run.started":
      return `${who} started a run`;
    case "run.finished":
      return `${who} finished a run`;
    case "run.failed":
      return `${who}'s run failed`;
    case "pr.opened":
    case "pr.merged":
    case "pr.closed":
      return pr?.title ?? event.summary;
    case "branch.created":
      return `New branch ${event.branch ?? ""}`;
    case "branch.updated":
      return `New commits on ${event.branch ?? ""}`;
    case "branch.deleted":
      return `Branch ${event.branch ?? ""} was deleted`;
    default:
      return event.summary;
  }
}

export function ActivityTab({ activity, loading, newEventIds }: ActivityTabProps) {
  const hostNavigation = useHostNavigation();

  if (loading && !activity) return <div style={{ padding: 16 }} className="gg-dim">Loading activity...</div>;

  const events = activity?.events ?? [];
  if (events.length === 0)
    return (
      <div style={{ padding: 16 }} className="gg-dim">
        No agent has pushed to this repo yet. Assign an issue and the branch shows here.
      </div>
    );

  const nameById = new Map((activity?.agents ?? []).map((agent) => [agent.agentId, agent.agentName]));
  const prByNumber = new Map<number, PullRequestInfo>();
  for (const issue of activity?.issues ?? []) if (issue.pr) prByNumber.set(issue.pr.number, issue.pr);
  for (const agent of activity?.agents ?? []) if (agent.pr) prByNumber.set(agent.pr.number, agent.pr);

  return (
    <div style={{ overflowY: "auto", overflowX: "hidden", height: "100%" }}>
      <div className="gg-table">
        <div className="gg-table-head" style={{ gridTemplateColumns: COLUMNS }}>
          <span>Time</span>
          <span>Event</span>
          <span>What happened</span>
          <span>Agent</span>
          <span>Issue, branch or PR</span>
        </div>
        {groupByDay(events).map((group) => (
          <div key={group.day}>
            <div style={{ padding: "10px 14px 4px", fontSize: 12, fontWeight: 600 }}>
              {dayLabel(group.day)} <span className="gg-dim" style={{ fontWeight: 400 }}>· {group.events.length} events</span>
            </div>
            {group.events.map((event) => {
              const agentName = event.agentName ?? (event.agentId ? nameById.get(event.agentId) : undefined);
              const pr = event.prNumber != null ? prByNumber.get(event.prNumber) : undefined;
              const text = describe(event, agentName, pr);
              return (
                <div
                  key={event.id}
                  className={newEventIds.has(event.id) ? "gg-table-row gg-new-row" : "gg-table-row"}
                  style={{ gridTemplateColumns: COLUMNS }}
                >
                  <span className="gg-mono gg-dim" title={new Date(event.at).toLocaleString()}>
                    {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span><Pill badge={EVENT_BADGE[event.kind] ?? { label: event.kind, color: "var(--muted-foreground)" }} /></span>
                  <span title={text}>{text}</span>
                  <span className={agentName ? undefined : "gg-dim"} title={agentName}>{agentName ?? "-"}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {event.issueIdentifier && (
                      <a className="gg-link gg-mono" {...hostNavigation.linkProps(`/issues/${event.issueIdentifier}`)}>
                        {event.issueIdentifier}
                      </a>
                    )}
                    {event.prNumber != null &&
                      (pr ? (
                        <a className="gg-link gg-mono" href={pr.url} target="_blank" rel="noreferrer">PR #{event.prNumber}</a>
                      ) : (
                        <span className="gg-mono">PR #{event.prNumber}</span>
                      ))}
                    {event.branch && !event.issueIdentifier && (
                      <span className="gg-mono gg-dim gg-ell" title={event.branch}>{event.branch}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <style>{`
        .gg-new-row { animation: gg-fade-in 160ms ease; }
        @keyframes gg-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .gg-new-row { animation: none; } }
      `}</style>
    </div>
  );
}
