CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  description TEXT,
  full_description TEXT,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  contract_type TEXT,
  salary TEXT,
  published_at TEXT,
  scraped_at TEXT DEFAULT (datetime('now')),
  matching_score INTEGER DEFAULT 0,
  matched_skills TEXT,
  status TEXT DEFAULT 'new',
  cover_letter TEXT,
  cv_used TEXT,
  notes TEXT,
  applied_at TEXT,
  response_at TEXT,
  response_type TEXT,
  alternate_urls TEXT,
  alternate_sources TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(matching_score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped ON jobs(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
