CREATE TABLE IF NOT EXISTS plugin_git_graph_ce45bbd709.commits (
  company_id text NOT NULL,
  sha text NOT NULL,
  position integer NOT NULL,
  parents text[] NOT NULL DEFAULT '{}',
  author text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  date timestamptz NOT NULL,
  subject text NOT NULL DEFAULT '',
  is_head boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, sha)
);

CREATE INDEX IF NOT EXISTS commits_company_position_idx ON plugin_git_graph_ce45bbd709.commits (company_id, position);

CREATE TABLE IF NOT EXISTS plugin_git_graph_ce45bbd709.refs (
  company_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  sha text NOT NULL,
  upstream text,
  ahead integer,
  behind integer,
  is_current boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, name)
);

CREATE TABLE IF NOT EXISTS plugin_git_graph_ce45bbd709.pull_requests (
  company_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  state text NOT NULL,
  author text NOT NULL DEFAULT '',
  head_ref text NOT NULL DEFAULT '',
  base_ref text NOT NULL DEFAULT '',
  reviewers text[] NOT NULL DEFAULT '{}',
  checks text,
  updated_at timestamptz,
  PRIMARY KEY (company_id, number)
);

CREATE TABLE IF NOT EXISTS plugin_git_graph_ce45bbd709.events (
  id bigserial PRIMARY KEY,
  company_id text NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  branch text,
  sha text,
  agent_id text,
  agent_name text,
  issue_identifier text,
  pr_number integer,
  summary text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS events_company_at_idx ON plugin_git_graph_ce45bbd709.events (company_id, at DESC);

-- extra_json carries the parts of RepoSnapshot that have no dedicated table
-- (worktrees, ownership) so a cache hit needs no recompute pass.
CREATE TABLE IF NOT EXISTS plugin_git_graph_ce45bbd709.snapshot_meta (
  company_id text PRIMARY KEY,
  head_sha text,
  refs_hash text NOT NULL DEFAULT '',
  generated_at timestamptz NOT NULL,
  commit_count integer NOT NULL DEFAULT 0,
  extra_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
