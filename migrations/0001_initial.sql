PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  official_url TEXT NOT NULL,
  reward_usd REAL NOT NULL DEFAULT 0,
  reward_currency TEXT NOT NULL DEFAULT 'USD',
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN (
    'DISCOVERED', 'SELECTED', 'IN_PROGRESS', 'SUBMITTED', 'WON', 'PAID',
    'REJECTED', 'FAILED', 'EXPIRED'
  )),
  raw_json TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  decision TEXT NOT NULL CHECK (decision IN ('EXECUTE', 'WATCHLIST', 'REJECT')),
  expected_reward_usd REAL NOT NULL,
  expected_net_usd REAL NOT NULL,
  expected_value_per_hour REAL NOT NULL,
  capital_usd REAL NOT NULL,
  gas_usd REAL NOT NULL,
  time_hours REAL NOT NULL,
  success_probability REAL NOT NULL,
  competition_level REAL NOT NULL,
  technical_difficulty TEXT NOT NULL,
  reputation_score REAL NOT NULL,
  payout_evidence_score REAL NOT NULL,
  risk_flags_json TEXT NOT NULL,
  score_breakdown_json TEXT NOT NULL,
  rationale_en TEXT NOT NULL,
  rationale_zh TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_runs (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  state TEXT NOT NULL,
  artifact_url TEXT,
  notes TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('REVENUE', 'EXPENSE', 'PENDING_REWARD')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'EXCLUDED')),
  chain TEXT,
  asset TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  amount_atomic TEXT,
  tx_hash TEXT,
  payer TEXT,
  receiver TEXT,
  is_external INTEGER NOT NULL DEFAULT 0 CHECK (is_external IN (0, 1)),
  gas_usd REAL NOT NULL DEFAULT 0,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE(chain, tx_hash)
);

CREATE TABLE IF NOT EXISTS report_snapshots (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL UNIQUE,
  opportunity_report_json TEXT NOT NULL,
  execution_plan_json TEXT NOT NULL,
  revenue_report_json TEXT NOT NULL,
  improvement_report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
  execution_key TEXT PRIMARY KEY,
  cron TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  usage_date TEXT PRIMARY KEY,
  call_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS txline_events (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  replay_order INTEGER NOT NULL,
  UNIQUE(fixture_id, replay_order)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status_updated ON opportunities(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluations_opportunity_created ON evaluations(opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluations_score_created ON evaluations(score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_external_confirmed ON ledger_entries(is_external, status, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_txline_fixture_order ON txline_events(fixture_id, replay_order);

