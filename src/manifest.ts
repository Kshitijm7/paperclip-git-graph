import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { FOLDER_KEY } from "./shared/types.js";

export const DEFAULT_BRANCH_PATTERN = "^agent/(?<issue>[A-Z]+-\\d+)-";
export const DEFAULT_COMMIT_LIMIT = 400;
export const DEFAULT_FETCH_INTERVAL_MINUTES = 15;

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip-git-graph",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Git Graph",
  description: "SourceGit-style commit graph inside Paperclip, with agent, issue and PR ownership per branch",
  author: "Kshitij Mittal",
  categories: ["ui"],
  capabilities: [
    "local.folders",
    "companies.read",
    "projects.read",
    "issues.read",
    "issue.comments.read",
    "agents.read",
    "http.outbound",
    "secrets.read-ref",
    "jobs.schedule",
    "plugin.state.read",
    "plugin.state.write",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
    "events.subscribe"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  localFolders: [
    {
      folderKey: FOLDER_KEY,
      displayName: "Git repository",
      description: "Absolute path to the git working copy this graph renders.",
      access: "read",
      requiredDirectories: [".git"]
    }
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      githubToken: {
        type: "object",
        title: "GitHub token",
        description: "Optional. Needed for private repositories and higher rate limits.",
        format: "secret-ref"
      },
      githubRepo: {
        type: "string",
        title: "GitHub repository",
        description: "owner/name. Leave empty to auto-detect from the origin remote.",
        pattern: "^$|^[^/\\s]+/[^/\\s]+$"
      },
      githubAuth: {
        type: "string",
        title: "GitHub auth",
        description: "How to authenticate to GitHub. 'auto' prefers a saved token, then the local gh CLI login.",
        enum: ["auto", "secret", "gh-cli", "none"],
        default: "auto"
      },
      fetchIntervalMinutes: {
        type: "number",
        title: "Fetch interval (minutes)",
        default: DEFAULT_FETCH_INTERVAL_MINUTES,
        minimum: 1,
        maximum: 1440
      },
      commitLimit: {
        type: "number",
        title: "Commit limit",
        default: DEFAULT_COMMIT_LIMIT,
        minimum: 1,
        maximum: 5000
      },
      branchPattern: {
        type: "string",
        title: "Branch ownership pattern",
        description: "Regex with a named group 'issue' that maps a branch name to an issue identifier.",
        default: DEFAULT_BRANCH_PATTERN
      }
    }
  },
  jobs: [
    {
      jobKey: "fetch",
      displayName: "Fetch remotes",
      description: "Runs git fetch --all --prune in the bound repository.",
      schedule: "*/15 * * * *"
    }
  ],
  ui: {
    slots: [
      { type: "page", id: "graph", displayName: "Git Graph", exportName: "GraphPage", routePath: "git-graph" },
      { type: "sidebar", id: "nav", displayName: "Git Graph", exportName: "SidebarLink" },
      { type: "dashboardWidget", id: "summary", displayName: "Git Graph Summary", exportName: "SummaryWidget" }
    ]
  }
};

export default manifest;
