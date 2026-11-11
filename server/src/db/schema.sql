CREATE TABLE IF NOT EXISTS registered_apis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  headers TEXT,
  sample_params TEXT,
  output_schema TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  variables TEXT,
  nodes TEXT NOT NULL,
  edges TEXT NOT NULL,
  publish_path TEXT,
  is_published BOOLEAN DEFAULT 0,
  auth_type TEXT DEFAULT 'none',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER,
  status TEXT,
  context TEXT,
  logs TEXT,
  result TEXT,
  started_at DATETIME,
  ended_at DATETIME,
  temporal_workflow_id TEXT,
  engine_version TEXT,
  start_state TEXT DEFAULT 'legacy',
  request_key TEXT,
  workflow_snapshot TEXT,
  variables_snapshot TEXT,
  limits_snapshot TEXT,
  result_ref TEXT,
  completion_status TEXT,
  completion_error TEXT
);

CREATE TABLE IF NOT EXISTS execution_values (
  ref TEXT PRIMARY KEY,
  execution_id INTEGER NOT NULL REFERENCES executions(id),
  kind TEXT NOT NULL CHECK(kind IN ('value', 'context')),
  data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS node_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL REFERENCES executions(id),
  invocation_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  scope_path TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  input_ref TEXT,
  output_ref TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT,
  UNIQUE(execution_id, invocation_id, attempt)
);

CREATE TABLE IF NOT EXISTS node_results (
  execution_id INTEGER NOT NULL REFERENCES executions(id),
  invocation_id TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY(execution_id, invocation_id)
);

CREATE TABLE IF NOT EXISTS execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL REFERENCES executions(id),
  event_key TEXT NOT NULL,
  type TEXT NOT NULL,
  node_id TEXT NOT NULL,
  data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(execution_id, event_key)
);
CREATE INDEX IF NOT EXISTS node_runs_execution ON node_runs(execution_id, sequence, attempt);
CREATE INDEX IF NOT EXISTS node_runs_output ON node_runs(execution_id, output_ref);
CREATE INDEX IF NOT EXISTS execution_events_cursor ON execution_events(execution_id, id);
