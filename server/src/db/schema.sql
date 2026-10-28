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
  ended_at DATETIME
);
