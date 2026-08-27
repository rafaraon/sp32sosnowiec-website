-- Migracja 001: pola RODO w tabeli galleries
-- Data: 2026-08-27
-- Run: wrangler d1 execute sp32-cms --file=migrations/001_rodo_fields.sql

-- cohort_year: rok ukończenia szkoły przez klasę (np. 2031)
-- Pozwala Scheduled Workerowi wiedzieć kiedy usunąć/zanonimizować zdjęcia
ALTER TABLE galleries ADD COLUMN cohort_year INTEGER;

-- consent_id: numer papierowej zgody rodzica/opiekuna (np. "ZG/2026/042")
-- Umożliwia powiązanie rekordu cyfrowego z fizycznym dokumentem w szkole
ALTER TABLE galleries ADD COLUMN consent_id TEXT;
