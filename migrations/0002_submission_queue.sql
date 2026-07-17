CREATE TABLE IF NOT EXISTS submission_queue (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  listing_type TEXT NOT NULL CHECK (listing_type IN ('bounty', 'project', 'hackathon')),
  link TEXT NOT NULL,
  tweet TEXT NOT NULL DEFAULT '',
  other_info TEXT NOT NULL,
  eligibility_answers_json TEXT NOT NULL DEFAULT '[]',
  ask REAL,
  telegram TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SUBMITTING', 'SUBMITTED', 'FAILED')),
  response_json TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  UNIQUE(opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_queue_status_created
  ON submission_queue(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_submission_queue_submitted_at
  ON submission_queue(submitted_at DESC);

