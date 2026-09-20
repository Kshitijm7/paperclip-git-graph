import { useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { ActivityData } from "../../shared/types.js";
import { relativeDate, shortDate } from "../theme.js";
import { EVENT_ICON, groupByDay } from "./helpers.js";

interface ActivityTabProps {
  activity: ActivityData | null;
  loading: boolean;
  newEventIds: ReadonlySet<string>;
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

  const groups = groupByDay(events);
  const prByNumber = new Map<number, string>();
  for (const issue of activity?.issues ?? []) {
    if (issue.pr) prByNumber.set(issue.pr.number, issue.pr.url);
  }

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "8px 12px" }}>
      {groups.map((group) => (
        <div key={group.day} style={{ marginBottom: 12 }}>
          <div className="gg-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 0" }}>
            {group.day}
          </div>
          {group.events.map((event) => {
            const prUrl = event.prNumber != null ? prByNumber.get(event.prNumber) : undefined;
            return (
              <div
                key={event.id}
                className={newEventIds.has(event.id) ? "gg-new-row" : undefined}
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 20px minmax(0,1fr) 110px 100px",
                  gap: 8,
                  alignItems: "center",
                  height: 26,
                  transition: "opacity 160ms ease",
                }}
              >
                <span className="gg-dim gg-mono">{new Date(event.at).toTimeString().slice(0, 8)}</span>
                <span aria-hidden="true">{EVENT_ICON[event.kind]}</span>
                <span className="gg-ell" title={event.summary}>{event.summary}</span>
                <span className="gg-ell gg-dim">{event.agentName ?? ""}</span>
                <span>
                  {event.issueIdentifier && (
                    <a className="gg-link" {...hostNavigation.linkProps(`/issues/${event.issueIdentifier}`)}>
                      {event.issueIdentifier}
                    </a>
                  )}
                  {event.branch && <span className="gg-mono gg-dim gg-ell">{" "}{event.branch}</span>}
                  {prUrl && event.prNumber != null && (
                    <a className="gg-link" href={prUrl} target="_blank" rel="noreferrer">
                      {" "}#{event.prNumber}
                    </a>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <span title={events[0] ? shortDate(events[0].at) : ""} style={{ display: "none" }} />
      <style>{`
        .gg-new-row { animation: gg-fade-in 160ms ease; }
        @keyframes gg-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .gg-new-row { animation: none; } }
      `}</style>
    </div>
  );
}
