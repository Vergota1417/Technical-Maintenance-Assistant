CREATE TABLE IF NOT EXISTS maintenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_name TEXT NOT NULL DEFAULT '',
  raw_issue TEXT NOT NULL DEFAULT '',
  issue TEXT NOT NULL,
  reason TEXT,
  work_performed TEXT,
  results TEXT,
  result_confirmed INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  user_modified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maintenance_created_at
  ON maintenance_records(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_machine
  ON maintenance_records(machine_name);
