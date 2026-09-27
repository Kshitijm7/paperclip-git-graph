CREATE TABLE IF NOT EXISTS plugin_git_graph_ce45bbd709.commit_provenance (
  company_id text NOT NULL,
  sha text NOT NULL,
  agent_id text NOT NULL,
  agent_name text,
  run_id text,
  at timestamptz NOT NULL,
  PRIMARY KEY (company_id, sha)
);
