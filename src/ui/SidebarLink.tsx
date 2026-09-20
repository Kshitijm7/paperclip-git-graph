import { useHostNavigation, type PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";
import { CSS } from "./theme.js";

// Page slots own /:companyPrefix/<routePath>; linkProps adds the company prefix.
export const GIT_GRAPH_ROUTE = "/git-graph";

export function SidebarLink(_props: PluginSidebarProps) {
  const hostNavigation = useHostNavigation();
  return (
    <span className="gg-root" style={{ display: "block", background: "none" }}>
      <style>{CSS}</style>
      <a
        {...hostNavigation.linkProps(GIT_GRAPH_ROUTE)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px",
          borderRadius: 4,
          color: "inherit",
          textDecoration: "none",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M4 2.5 V11.5 M4 7 H8.5 A2 2 0 0 0 10.5 5 V3.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <circle cx="4" cy="2.4" r="1.5" fill="currentColor" />
          <circle cx="4" cy="11.6" r="1.5" fill="currentColor" />
          <circle cx="10.5" cy="2.6" r="1.5" fill="currentColor" />
        </svg>
        Git Graph
      </a>
    </span>
  );
}
