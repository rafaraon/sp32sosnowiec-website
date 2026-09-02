-- Extend consent_requests for public submissions
ALTER TABLE consent_requests ADD COLUMN submitter_type TEXT NOT NULL DEFAULT 'parent';
ALTER TABLE consent_requests ADD COLUMN submitter_email TEXT;
ALTER TABLE consent_requests ADD COLUMN reference_number TEXT;
ALTER TABLE consent_requests ADD COLUMN director_approved_at TEXT;
ALTER TABLE consent_requests ADD COLUMN matched_albums TEXT; -- JSON: [{id,title,slug}]

CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_ref ON consent_requests(reference_number)
  WHERE reference_number IS NOT NULL;
