-- category column already added to news in 0001_initial.sql
-- This migration adds performance indexes

CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at);
CREATE INDEX IF NOT EXISTS idx_gallery_albums_published ON gallery_albums(published);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_album_id ON gallery_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_graduation_year ON gallery_photos(graduation_year);
CREATE INDEX IF NOT EXISTS idx_consent_requests_status ON consent_requests(status);
CREATE INDEX IF NOT EXISTS idx_consent_requests_requested_at ON consent_requests(requested_at);
