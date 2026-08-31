# Admin Panel — Plan 1: Fundament + Publiczne API + Dynamiczne strony

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać do statycznej strony SP32 warstwę API (Cloudflare Pages Functions + D1 + R2) i zamienić 7 statycznych stron na dynamiczne powłoki pobierające treść z API. Po ukończeniu tego planu strona ładuje aktualności, galerię, jadłospis, dokumenty i dane specjalistów z bazy danych. Panel admina nie istnieje jeszcze — treść uzupełnia się przez `wrangler d1 execute`.

**Architecture:** Cloudflare Pages Functions z Hono.js jako catch-all route `/api/*`. Publiczne endpointy cache'owane przez CDN (5 min). Główna strona pobiera dane client-side przez Alpine.js. D1 trzyma metadane, R2 trzyma pliki.

**Tech Stack:** TypeScript, Hono.js 4.x, Cloudflare Pages Functions, Cloudflare D1 (SQLite), Cloudflare R2, Alpine.js 3.x (self-hosted)

**Spec:** `docs/superpowers/specs/2026-08-30-admin-panel-design.md`

---

## Struktura plików

```
sp32sosnowiec-website/
├── functions/
│   ├── api/
│   │   └── [[catchall]].ts          ← główny entry point, re-eksportuje Hono app
│   └── _lib/
│       ├── types.ts                 ← Env, shared row types
│       ├── db.ts                    ← helpers D1 (query wrappers)
│       ├── r2.ts                    ← helpers R2 (upload, publicUrl)
│       ├── middleware/
│       │   └── cache.ts             ← ustawia Cache-Control na public endpoints
│       └── routes/
│           └── public.ts            ← wszystkie GET /api/public/* routes
├── migrations/
│   └── 0001_initial.sql             ← D1 schema
├── alpine.min.js                    ← self-hosted Alpine 3.x
├── wrangler.toml
├── package.json
├── tsconfig.json
└── _src/pages/
    ├── aktualnosci.html             ← zamieniona na dynamic shell
    ├── artykul.html                 ← zamieniona na dynamic shell
    ├── galeria.html                 ← zamieniona na dynamic shell
    ├── jadlospis.html               ← zamieniona na dynamic shell
    ├── psycholog.html               ← zamieniona na dynamic shell
    ├── pedagog.html                 ← zamieniona na dynamic shell
    ├── doradca.html                 ← zamieniona na dynamic shell
    ├── pielegnarka.html             ← zamieniona na dynamic shell
    └── dokumenty.html              ← NOWA strona
```

---

## Task 1: Package setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`

- [ ] **Zainstaluj zależności**

```bash
cd /Users/accept/Downloads/1-PROJEKTY/sp32sosnowiec-website
npm init -y
npm install hono
npm install --save-dev wrangler typescript @cloudflare/workers-types vitest
```

- [ ] **Utwórz `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["functions/**/*.ts", "migrations/**/*.ts"]
}
```

- [ ] **Utwórz `wrangler.toml`**

```toml
name = "sp32sosnowiec"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "."

[[d1_databases]]
binding = "DB"
database_name = "sp32-db"
database_id = "REPLACE_AFTER_CREATE"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "sp32-media"

[vars]
ADMIN_EMAIL = "sp32.tech@gmail.com"
MEDIA_PUBLIC_URL = "https://pub.sp32sosnowiec.pl"

[[triggers]]
crons = ["0 8 1 9 *"]
```

- [ ] **Dodaj skrypty do `package.json`**

```json
{
  "scripts": {
    "dev": "wrangler pages dev --port 8788 .",
    "deploy": "wrangler pages deploy .",
    "build": "python3 build.py",
    "db:migrate:local": "wrangler d1 migrations apply sp32-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply sp32-db --remote",
    "test": "vitest run"
  }
}
```

- [ ] **Utwórz bucket R2 i D1 database**

```bash
wrangler r2 bucket create sp32-media
wrangler d1 create sp32-db
```

Skopiuj `database_id` z outputu do `wrangler.toml`.

- [ ] **Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml
git commit -m "feat: add cloudflare pages functions setup"
```

---

## Task 2: D1 — migracja schematu

**Files:**
- Create: `migrations/0001_initial.sql`

- [ ] **Utwórz `migrations/0001_initial.sql`**

```sql
-- Aktualności
CREATE TABLE IF NOT EXISTS news (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  excerpt       TEXT,
  body_html     TEXT,
  cover_r2_key  TEXT,
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  author_email  TEXT
);

-- Galerie — albumy
CREATE TABLE IF NOT EXISTS gallery_albums (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  school_year     TEXT NOT NULL,
  class_label     TEXT,
  graduation_year INTEGER NOT NULL,
  event_date      TEXT,
  cover_r2_key    TEXT,
  published       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Galerie — zdjęcia
CREATE TABLE IF NOT EXISTS gallery_photos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id        INTEGER NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  r2_key          TEXT NOT NULL,
  r2_key_thumb    TEXT,
  consent_ref     TEXT,
  graduation_year INTEGER NOT NULL,
  anonymized      INTEGER NOT NULL DEFAULT 0,
  anonymized_at   TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dokumenty
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL CHECK(category IN ('dokumenty','zfss','druki','rodo')),
  title       TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  file_type   TEXT,
  file_size   INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by TEXT
);

-- Specjaliści
CREATE TABLE IF NOT EXISTS specialists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  role         TEXT NOT NULL UNIQUE CHECK(role IN ('psycholog','pedagog','doradca','pielegnarka')),
  name         TEXT NOT NULL,
  title_prefix TEXT,
  room         TEXT,
  phone_ext    TEXT,
  hours        TEXT NOT NULL DEFAULT '[]',
  active       INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Jadłospis
CREATE TABLE IF NOT EXISTS menu_weeks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start  TEXT NOT NULL UNIQUE,
  r2_key      TEXT,
  notes       TEXT,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wnioski RODO
CREATE TABLE IF NOT EXISTS consent_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_name    TEXT NOT NULL,
  class_label     TEXT,
  graduation_year INTEGER,
  request_type    TEXT NOT NULL CHECK(request_type IN ('withdrawal','deletion')),
  requested_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','resolved')),
  notes           TEXT
);

-- Seed: specjaliści (dane z istniejących stron)
INSERT OR IGNORE INTO specialists (role, name, title_prefix, room, phone_ext, hours) VALUES
  ('psycholog', 'Agnieszka Żak', 'mgr', '21', NULL,
   '[{"day":"Poniedziałek","from":"8:00","to":"15:40"},{"day":"Wtorek","from":"8:00","to":"15:40"},{"day":"Środa","from":"10:00","to":"16:00"},{"day":"Czwartek","from":"8:00","to":"15:00"},{"day":"Piątek","from":"8:00","to":"13:00"}]'),
  ('pedagog', 'Edyta Kołton', 'mgr', '20', '24',
   '[{"day":"Poniedziałek","from":"8:00","to":"15:40"},{"day":"Wtorek","from":"8:50","to":"15:40"},{"day":"Środa","from":"10:30","to":"16:00"},{"day":"Czwartek","from":"8:00","to":"12:00"},{"day":"Piątek","from":"8:00","to":"13:00"}]'),
  ('doradca', 'Dorota Zalas', 'mgr', '06', NULL,
   '[{"day":"Wtorek","from":"13:00","to":"16:00"},{"day":"Środa","from":"8:00","to":"15:00"}]'),
  ('pielegnarka', 'Agnieszka Gnacik', NULL, NULL, NULL,
   '[{"day":"Wtorek","from":"7:30","to":"11:30"},{"day":"Środa","from":"11:00","to":"15:00"},{"day":"Czwartek","from":"11:00","to":"15:00"},{"day":"Piątek","from":"7:30","to":"15:00"}]');
```

- [ ] **Uruchom migrację lokalnie**

```bash
npm run db:migrate:local
```

Oczekiwany output: `✅ Applied 1 migration(s)`

- [ ] **Sprawdź schemat**

```bash
wrangler d1 execute sp32-db --local --command "SELECT name FROM sqlite_master WHERE type='table';"
```

Oczekiwany output: tabele `news`, `gallery_albums`, `gallery_photos`, `documents`, `specialists`, `menu_weeks`, `consent_requests`

- [ ] **Commit**

```bash
git add migrations/
git commit -m "feat: add D1 schema migration with specialist seed data"
```

---

## Task 3: Shared types i helpers

**Files:**
- Create: `functions/_lib/types.ts`
- Create: `functions/_lib/db.ts`
- Create: `functions/_lib/r2.ts`

- [ ] **Utwórz `functions/_lib/types.ts`**

```typescript
export type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  ADMIN_EMAIL: string
  MEDIA_PUBLIC_URL: string
}

export interface NewsRow {
  id: number
  title: string
  slug: string
  excerpt: string | null
  body_html: string | null
  cover_r2_key: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  author_email: string | null
}

export interface GalleryAlbumRow {
  id: number
  title: string
  slug: string
  school_year: string
  class_label: string | null
  graduation_year: number
  event_date: string | null
  cover_r2_key: string | null
  published: number
  created_at: string
}

export interface GalleryPhotoRow {
  id: number
  album_id: number
  r2_key: string
  r2_key_thumb: string | null
  consent_ref: string | null
  graduation_year: number
  anonymized: number
  anonymized_at: string | null
  sort_order: number
  created_at: string
}

export interface DocumentRow {
  id: number
  category: 'dokumenty' | 'zfss' | 'druki' | 'rodo'
  title: string
  r2_key: string
  file_type: string | null
  file_size: number | null
  sort_order: number
  published: number
  uploaded_at: string
  uploaded_by: string | null
}

export interface SpecialistRow {
  id: number
  role: 'psycholog' | 'pedagog' | 'doradca' | 'pielegnarka'
  name: string
  title_prefix: string | null
  room: string | null
  phone_ext: string | null
  hours: string  // JSON string
  active: number
  updated_at: string
}

export interface MenuWeekRow {
  id: number
  week_start: string
  r2_key: string | null
  notes: string | null
  published: number
  created_at: string
}

export interface SpecialistHour {
  day: string
  from: string
  to: string
}

// Oblicza graduation_year z roku szkolnego i klasy
// class_label: "3a", "8c", itd. — lub null dla ogólnoszkolnych
// school_year: "2024/2025"
export function calcGraduationYear(schoolYear: string, classLabel: string | null): number {
  const endYear = parseInt(schoolYear.split('/')[1], 10)
  if (!classLabel) return endYear  // ogólnoszkolne → klasa 8 tego roku
  const classNum = parseInt(classLabel.replace(/\D/g, ''), 10)
  return endYear + (8 - classNum)
}
```

- [ ] **Napisz testy dla `calcGraduationYear`**

Utwórz `functions/_lib/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calcGraduationYear } from './types'

describe('calcGraduationYear', () => {
  it('klasa 3a, rok 2024/2025 → 2030', () => {
    expect(calcGraduationYear('2024/2025', '3a')).toBe(2030)
  })
  it('klasa 8b, rok 2024/2025 → 2025', () => {
    expect(calcGraduationYear('2024/2025', '8b')).toBe(2025)
  })
  it('klasa 1c, rok 2025/2026 → 2033', () => {
    expect(calcGraduationYear('2025/2026', '1c')).toBe(2033)
  })
  it('ogólnoszkolne (null), rok 2024/2025 → 2025', () => {
    expect(calcGraduationYear('2024/2025', null)).toBe(2025)
  })
})
```

- [ ] **Uruchom testy**

```bash
npm test
```

Oczekiwany output: `4 tests passed`

- [ ] **Utwórz `functions/_lib/db.ts`**

```typescript
import type { Env, NewsRow, GalleryAlbumRow, GalleryPhotoRow, DocumentRow, SpecialistRow, MenuWeekRow } from './types'

export function publicUrl(env: Env, key: string): string {
  return `${env.MEDIA_PUBLIC_URL}/${key}`
}

export function newsToJson(row: NewsRow, env: Env) {
  return {
    ...row,
    cover_url: row.cover_r2_key ? publicUrl(env, row.cover_r2_key) : null,
  }
}

export function albumToJson(row: GalleryAlbumRow, env: Env) {
  return {
    ...row,
    cover_url: row.cover_r2_key ? publicUrl(env, row.cover_r2_key) : null,
    published: row.published === 1,
  }
}

export function photoToJson(row: GalleryPhotoRow, env: Env) {
  return {
    ...row,
    url: publicUrl(env, row.r2_key),
    thumb_url: row.r2_key_thumb ? publicUrl(env, row.r2_key_thumb) : publicUrl(env, row.r2_key),
    anonymized: row.anonymized === 1,
  }
}

export function documentToJson(row: DocumentRow, env: Env) {
  return {
    ...row,
    url: publicUrl(env, row.r2_key),
    published: row.published === 1,
  }
}

export function specialistToJson(row: SpecialistRow) {
  return {
    ...row,
    hours: JSON.parse(row.hours),
    active: row.active === 1,
  }
}

export function menuToJson(row: MenuWeekRow, env: Env) {
  return {
    ...row,
    url: row.r2_key ? publicUrl(env, row.r2_key) : null,
    published: row.published === 1,
  }
}
```

- [ ] **Utwórz `functions/_lib/r2.ts`**

```typescript
import type { Env } from './types'

// Generuje unikalny klucz R2 z timestampem
export function r2Key(prefix: string, filename: string): string {
  const ts = Date.now()
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
  return `${prefix}/${ts}-${safe}`
}

// Wgrywa plik do R2, zwraca klucz
export async function uploadToR2(
  env: Env,
  key: string,
  file: File | Blob,
  contentType?: string
): Promise<string> {
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: contentType ?? file.type },
  })
  return key
}

// Usuwa plik z R2 (cicho jeśli nie istnieje)
export async function deleteFromR2(env: Env, key: string): Promise<void> {
  await env.MEDIA.delete(key)
}
```

- [ ] **Commit**

```bash
git add functions/
git commit -m "feat: add shared types, db helpers, r2 helpers"
```

---

## Task 4: Hono app skeleton + cache middleware

**Files:**
- Create: `functions/api/[[catchall]].ts`
- Create: `functions/_lib/middleware/cache.ts`
- Create: `functions/_lib/routes/public.ts` (szkielet)

- [ ] **Utwórz `functions/_lib/middleware/cache.ts`**

```typescript
import type { Context, Next } from 'hono'
import type { Env } from '../types'

// Ustawia Cache-Control dla publicznych endpointów
export async function cacheMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  await next()
  if (c.res.ok) {
    c.res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
  }
}
```

- [ ] **Utwórz szkielet `functions/_lib/routes/public.ts`**

```typescript
import { Hono } from 'hono'
import type { Env } from '../types'

export const publicRouter = new Hono<{ Bindings: Env }>()

// Endpointy dodawane w kolejnych taskach
publicRouter.get('/news', async (c) => c.json({ items: [] }))
publicRouter.get('/news/:slug', async (c) => c.json({ item: null }))
publicRouter.get('/gallery', async (c) => c.json({ albums: [] }))
publicRouter.get('/gallery/:slug', async (c) => c.json({ album: null }))
publicRouter.get('/documents/:category', async (c) => c.json({ documents: [] }))
publicRouter.get('/specialists', async (c) => c.json({ specialists: [] }))
publicRouter.get('/menu/current', async (c) => c.json({ menu: null }))
```

- [ ] **Utwórz `functions/api/[[catchall]].ts`**

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '../_lib/types'
import { publicRouter } from '../_lib/routes/public'
import { cacheMiddleware } from '../_lib/middleware/cache'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE'] }))

app.use('/api/public/*', cacheMiddleware)
app.route('/api/public', publicRouter)

// Health check
app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// 404 dla nieznanych
app.notFound((c) => c.json({ error: 'not found' }, 404))

export const onRequest = app.fetch
```

- [ ] **Uruchom dev server i przetestuj**

```bash
npm run dev
```

W nowym terminalu:
```bash
curl http://localhost:8788/api/health
```
Oczekiwany output: `{"ok":true,"ts":"2026-..."}`

```bash
curl http://localhost:8788/api/public/news
```
Oczekiwany output: `{"items":[]}`

- [ ] **Commit**

```bash
git add functions/
git commit -m "feat: add hono app skeleton with public router stubs"
```

---

## Task 5: Publiczne API — aktualności

**Files:**
- Modify: `functions/_lib/routes/public.ts`

- [ ] **Zastąp stub news endpointów rzeczywistą implementacją**

```typescript
import { Hono } from 'hono'
import type { Env, NewsRow } from '../types'
import { newsToJson } from '../db'

export const publicRouter = new Hono<{ Bindings: Env }>()

publicRouter.get('/news', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 50)
  const rows = await c.env.DB.prepare(
    `SELECT * FROM news WHERE published_at IS NOT NULL AND published_at <= datetime('now')
     ORDER BY published_at DESC LIMIT ?`
  ).bind(limit).all<NewsRow>()

  return c.json({ items: (rows.results ?? []).map(r => newsToJson(r, c.env)) })
})

publicRouter.get('/news/:slug', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM news WHERE slug = ? AND published_at IS NOT NULL AND published_at <= datetime('now')`
  ).bind(c.req.param('slug')).first<NewsRow>()

  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json({ item: newsToJson(row, c.env) })
})

// pozostałe stuby — zostaną zastąpione w Task 6 i 7
publicRouter.get('/gallery', async (c) => c.json({ albums: [] }))
publicRouter.get('/gallery/:slug', async (c) => c.json({ album: null, photos: [] }))
publicRouter.get('/documents/:category', async (c) => c.json({ documents: [] }))
publicRouter.get('/specialists', async (c) => c.json({ specialists: [] }))
publicRouter.get('/menu/current', async (c) => c.json({ menu: null }))
```

- [ ] **Dodaj testową aktualność do lokalnej D1**

```bash
wrangler d1 execute sp32-db --local --command "
INSERT INTO news (title, slug, excerpt, body_html, published_at, author_email)
VALUES (
  'Witamy na nowej stronie SP32',
  'witamy-na-nowej-stronie',
  'Uruchomiliśmy nową stronę szkoły.',
  '<p>Witamy wszystkich uczniów i rodziców na nowej stronie Szkoły Podstawowej nr 32.</p>',
  datetime(''now''),
  'sp32.tech@gmail.com'
);"
```

- [ ] **Przetestuj endpoint**

```bash
curl http://localhost:8788/api/public/news
```
Oczekiwany output: `{"items":[{"id":1,"title":"Witamy na nowej stronie SP32",...}]}`

```bash
curl http://localhost:8788/api/public/news/witamy-na-nowej-stronie
```
Oczekiwany output: `{"item":{"id":1,...}}`

```bash
curl http://localhost:8788/api/public/news/nieistniejacy
```
Oczekiwany output: `{"error":"not found"}` z HTTP 404

- [ ] **Commit**

```bash
git add functions/_lib/routes/public.ts
git commit -m "feat: implement GET /api/public/news endpoints"
```

---

## Task 6: Publiczne API — galeria

**Files:**
- Modify: `functions/_lib/routes/public.ts`

- [ ] **Zastąp stuby galerii**

```typescript
// Dodaj do importów:
import type { Env, NewsRow, GalleryAlbumRow, GalleryPhotoRow } from '../types'
import { newsToJson, albumToJson, photoToJson } from '../db'

// Zastąp stub /gallery:
publicRouter.get('/gallery', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM gallery_albums WHERE published = 1 ORDER BY event_date DESC, created_at DESC LIMIT 50`
  ).all<GalleryAlbumRow>()

  return c.json({ albums: (rows.results ?? []).map(r => albumToJson(r, c.env)) })
})

// Zastąp stub /gallery/:slug:
publicRouter.get('/gallery/:slug', async (c) => {
  const album = await c.env.DB.prepare(
    `SELECT * FROM gallery_albums WHERE slug = ? AND published = 1`
  ).bind(c.req.param('slug')).first<GalleryAlbumRow>()

  if (!album) return c.json({ error: 'not found' }, 404)

  const photos = await c.env.DB.prepare(
    `SELECT * FROM gallery_photos WHERE album_id = ? ORDER BY sort_order ASC, created_at ASC`
  ).bind(album.id).all<GalleryPhotoRow>()

  return c.json({
    album: albumToJson(album, c.env),
    photos: (photos.results ?? []).map(r => photoToJson(r, c.env)),
  })
})
```

- [ ] **Przetestuj**

```bash
curl http://localhost:8788/api/public/gallery
```
Oczekiwany output: `{"albums":[]}` (brak danych — OK)

- [ ] **Commit**

```bash
git add functions/_lib/routes/public.ts
git commit -m "feat: implement GET /api/public/gallery endpoints"
```

---

## Task 7: Publiczne API — dokumenty, specjaliści, jadłospis

**Files:**
- Modify: `functions/_lib/routes/public.ts`

- [ ] **Zastąp pozostałe trzy stuby**

```typescript
// Dodaj do importów:
import type { Env, NewsRow, GalleryAlbumRow, GalleryPhotoRow, DocumentRow, SpecialistRow, MenuWeekRow } from '../types'
import { newsToJson, albumToJson, photoToJson, documentToJson, specialistToJson, menuToJson } from '../db'

// /documents/:category
publicRouter.get('/documents/:category', async (c) => {
  const category = c.req.param('category')
  const allowed = ['dokumenty', 'zfss', 'druki', 'rodo']
  if (!allowed.includes(category)) return c.json({ error: 'invalid category' }, 400)

  // ZFŚS nie jest publiczne — endpointy admina obsłużą to w Planie 2
  if (category === 'zfss') return c.json({ error: 'forbidden' }, 403)

  const rows = await c.env.DB.prepare(
    `SELECT * FROM documents WHERE category = ? AND published = 1 ORDER BY sort_order ASC, uploaded_at DESC`
  ).bind(category).all<DocumentRow>()

  return c.json({ documents: (rows.results ?? []).map(r => documentToJson(r, c.env)) })
})

// /specialists
publicRouter.get('/specialists', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM specialists WHERE active = 1 ORDER BY id ASC`
  ).all<SpecialistRow>()

  return c.json({ specialists: (rows.results ?? []).map(specialistToJson) })
})

// /menu/current — bieżący tydzień lub następny dostępny
publicRouter.get('/menu/current', async (c) => {
  const today = new Date().toISOString().split('T')[0]
  // Poniedziałek bieżącego tygodnia
  const d = new Date(today)
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1  // 0=pon
  d.setDate(d.getDate() - day)
  const monday = d.toISOString().split('T')[0]

  const row = await c.env.DB.prepare(
    `SELECT * FROM menu_weeks WHERE week_start >= ? AND published = 1 ORDER BY week_start ASC LIMIT 1`
  ).bind(monday).first<MenuWeekRow>()

  return c.json({ menu: row ? menuToJson(row, c.env) : null })
})
```

- [ ] **Przetestuj specjalistów (seed data)**

```bash
curl http://localhost:8788/api/public/specialists
```
Oczekiwany output: JSON z 4 specjalistami (psycholog, pedagog, doradca, pielegnarka) z godzinami jako tablicą obiektów.

- [ ] **Przetestuj jadłospis**

```bash
curl http://localhost:8788/api/public/menu/current
```
Oczekiwany output: `{"menu":null}` (brak danych — OK)

- [ ] **Commit**

```bash
git add functions/_lib/routes/public.ts
git commit -m "feat: implement GET /api/public/documents, /specialists, /menu/current"
```

---

## Task 8: Alpine.js + dynamiczne strony — aktualności i artykuł

**Files:**
- Modify: `_src/pages/aktualnosci.html`
- Modify: `_src/pages/artykul.html`
- Create: `alpine.min.js` (pobrany lokalnie)

- [ ] **Pobierz Alpine.js do repo**

```bash
curl -sL https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js -o alpine.min.js
```

Alternatywnie: pobierz ręcznie z https://alpinejs.dev i zapisz jako `alpine.min.js`.

- [ ] **Zastąp zawartość `_src/pages/aktualnosci.html`**

```html
{% extends "_base.html" %}
{% block page_title %}Aktualności{% endblock %}
{% block eyebrow %}Szkoła Podstawowa nr 32{% endblock %}
{% block hero_title %}Aktualności{% endblock %}
{% block breadcrumb_page %}Aktualności{% endblock %}
{% block page_css %}
<style>
.news-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem;margin-top:2rem}
.news-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);transition:box-shadow var(--tr),transform var(--tr);text-decoration:none;color:inherit;display:flex;flex-direction:column}
.news-card:hover{box-shadow:var(--sh-m);transform:translateY(-2px)}
.news-card img{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--clv)}
.news-card-body{padding:1.25rem;flex:1;display:flex;flex-direction:column;gap:.4rem}
.news-date{font-family:var(--font-d);font-size:.7rem;font-weight:700;color:var(--ca);letter-spacing:.05em;text-transform:uppercase}
.news-card h2{font-family:var(--font-d);font-size:1rem;font-weight:800;color:var(--tx);line-height:1.35}
.news-card p{font-size:.88rem;color:var(--tx-m);line-height:1.6;margin-top:.2rem}
.skel-card{background:var(--clv);border-radius:var(--r);height:280px;animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.fetch-error{background:var(--clv-l);border:1px solid var(--bd);border-radius:var(--r);padding:2rem;text-align:center;margin-top:2rem}
.fetch-error p{color:var(--tx-m);font-size:.95rem}
.fetch-error a{color:var(--cp);font-weight:700}
</style>
{% endblock %}
{% block content %}
<div class="container page-main">
<div x-data="newsApp()" x-init="load()">
  <template x-if="loading">
    <div class="news-grid">
      <div class="skel-card"></div>
      <div class="skel-card"></div>
      <div class="skel-card"></div>
    </div>
  </template>
  <template x-if="error">
    <div class="fetch-error">
      <p>Treść chwilowo niedostępna. <a href="" @click.prevent="load()">Spróbuj ponownie →</a></p>
    </div>
  </template>
  <template x-if="!loading && !error && items.length === 0">
    <p style="color:var(--tx-m);margin-top:2rem">Brak aktualności.</p>
  </template>
  <template x-if="!loading && !error && items.length > 0">
    <div class="news-grid">
      <template x-for="item in items" :key="item.id">
        <a :href="'artykul.html?slug=' + item.slug" class="news-card">
          <img x-show="item.cover_url" :src="item.cover_url" :alt="item.title" loading="lazy">
          <div style="width:100%;aspect-ratio:16/9;background:var(--clv)" x-show="!item.cover_url"></div>
          <div class="news-card-body">
            <p class="news-date" x-text="fmtDate(item.published_at)"></p>
            <h2 x-text="item.title"></h2>
            <p x-text="item.excerpt"></p>
          </div>
        </a>
      </template>
    </div>
  </template>
</div>
</div>
<script>
function newsApp(){
  return{
    items:[],loading:true,error:false,
    async load(){
      this.loading=true;this.error=false;
      try{
        const r=await fetch('/api/public/news');
        if(!r.ok)throw new Error();
        const d=await r.json();
        this.items=d.items;
      }catch{this.error=true}
      finally{this.loading=false}
    },
    fmtDate(iso){
      if(!iso)return'';
      return new Date(iso).toLocaleDateString('pl-PL',{day:'numeric',month:'long',year:'numeric'});
    }
  }
}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Zastąp zawartość `_src/pages/artykul.html`**

```html
{% extends "_base.html" %}
{% block page_title %}Aktualność{% endblock %}
{% block eyebrow %}Aktualności{% endblock %}
{% block hero_title %}&nbsp;{% endblock %}
{% block breadcrumb_page %}Aktualność{% endblock %}
{% block page_css %}
<style>
.article-cover{width:100%;max-height:400px;object-fit:cover;border-radius:var(--r);margin-bottom:2rem}
.article-meta{font-family:var(--font-d);font-size:.75rem;font-weight:700;color:var(--ca);letter-spacing:.05em;text-transform:uppercase;margin-bottom:1rem}
.article-title{font-family:var(--font-d);font-size:2rem;font-weight:800;color:var(--tx);letter-spacing:-.03em;margin-bottom:1.5rem;line-height:1.2;text-wrap:balance}
.article-body{max-width:720px;font-size:1rem;color:var(--tx-m);line-height:1.8}
.article-body h2{font-family:var(--font-d);font-size:1.35rem;font-weight:800;color:var(--tx);margin:2rem 0 .75rem}
.article-body p{margin-bottom:1rem}
.article-body img{max-width:100%;border-radius:var(--r-s);margin:1rem 0}
.article-body a{color:var(--cp);font-weight:600}
.skel-text{background:var(--clv);border-radius:4px;animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
</style>
{% endblock %}
{% block content %}
<div class="container page-main">
<div x-data="articleApp()" x-init="load()">
  <template x-if="loading">
    <div>
      <div class="skel-text" style="height:2rem;width:60%;margin-bottom:1rem"></div>
      <div class="skel-text" style="height:1rem;width:40%;margin-bottom:2rem"></div>
      <div class="skel-text" style="height:400px;margin-bottom:2rem;border-radius:var(--r)"></div>
    </div>
  </template>
  <template x-if="error">
    <div style="text-align:center;padding:3rem">
      <p style="color:var(--tx-m)">Nie znaleziono artykułu. <a href="aktualnosci.html" style="color:var(--cp);font-weight:700">← Wróć do aktualności</a></p>
    </div>
  </template>
  <template x-if="!loading && !error && item">
    <article>
      <img x-show="item.cover_url" :src="item.cover_url" :alt="item.title" class="article-cover" loading="lazy">
      <p class="article-meta" x-text="fmtDate(item.published_at)"></p>
      <h1 class="article-title" x-text="item.title"></h1>
      <div class="article-body" x-html="item.body_html"></div>
    </article>
  </template>
</div>
</div>
<script>
function articleApp(){
  return{
    item:null,loading:true,error:false,
    async load(){
      const params=new URLSearchParams(location.search);
      const slug=params.get('slug');
      if(!slug){this.error=true;this.loading=false;return}
      try{
        const r=await fetch('/api/public/news/'+encodeURIComponent(slug));
        if(!r.ok)throw new Error();
        const d=await r.json();
        this.item=d.item;
        if(this.item)document.title=this.item.title+' — SP32 Sosnowiec';
      }catch{this.error=true}
      finally{this.loading=false}
    },
    fmtDate(iso){
      if(!iso)return'';
      return new Date(iso).toLocaleDateString('pl-PL',{day:'numeric',month:'long',year:'numeric'});
    }
  }
}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Przebuduj strony**

```bash
python3 build.py
```

- [ ] **Przetestuj w przeglądarce**

```
http://localhost:8788/aktualnosci.html
```
Powinien pojawić się loader, potem karta z testową aktualnością.

```
http://localhost:8788/artykul.html?slug=witamy-na-nowej-stronie
```
Powinien pojawić się artykuł z tytułem i treścią.

- [ ] **Commit**

```bash
git add _src/pages/aktualnosci.html _src/pages/artykul.html aktualnosci.html artykul.html alpine.min.js
git commit -m "feat: aktualnosci + artykul as dynamic alpine shells"
```

---

## Task 9: Dynamiczne strony — galeria i jadłospis

**Files:**
- Modify: `_src/pages/galeria.html`
- Modify: `_src/pages/jadlospis.html`

- [ ] **Zastąp zawartość `_src/pages/galeria.html`**

```html
{% extends "_base.html" %}
{% block page_title %}Galeria{% endblock %}
{% block eyebrow %}Szkoła Podstawowa nr 32{% endblock %}
{% block hero_title %}Galeria{% endblock %}
{% block breadcrumb_page %}Galeria{% endblock %}
{% block page_css %}
<style>
.album-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem;margin-top:2rem}
.album-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);transition:box-shadow var(--tr),transform var(--tr);text-decoration:none;color:inherit;display:flex;flex-direction:column}
.album-card:hover{box-shadow:var(--sh-m);transform:translateY(-2px)}
.album-thumb{width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--clv)}
.album-thumb-placeholder{width:100%;aspect-ratio:4/3;background:var(--clv);display:flex;align-items:center;justify-content:center;font-size:2.5rem}
.album-body{padding:1rem;flex:1}
.album-meta{font-family:var(--font-d);font-size:.65rem;font-weight:700;color:var(--ca);letter-spacing:.05em;text-transform:uppercase;margin-bottom:.3rem}
.album-title{font-family:var(--font-d);font-size:.95rem;font-weight:800;color:var(--tx)}
.skel-card{background:var(--clv);border-radius:var(--r);height:220px;animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.75rem;margin-top:1.5rem}
.photo-thumb{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r-s);cursor:zoom-in;transition:opacity var(--tr)}
.photo-thumb:hover{opacity:.85}
</style>
{% endblock %}
{% block content %}
<div class="container page-main">
<div x-data="galleryApp()" x-init="load()">

  <!-- Lista albumów -->
  <template x-if="!currentAlbum">
    <div>
      <template x-if="loading">
        <div class="album-grid">
          <div class="skel-card"></div><div class="skel-card"></div><div class="skel-card"></div>
        </div>
      </template>
      <template x-if="!loading && albums.length === 0">
        <p style="color:var(--tx-m);margin-top:2rem">Brak albumów w galerii.</p>
      </template>
      <template x-if="!loading && albums.length > 0">
        <div class="album-grid">
          <template x-for="album in albums" :key="album.id">
            <a href="#" @click.prevent="openAlbum(album.slug)" class="album-card">
              <img x-show="album.cover_url" :src="album.cover_url" :alt="album.title" class="album-thumb" loading="lazy">
              <div class="album-thumb-placeholder" x-show="!album.cover_url">🖼️</div>
              <div class="album-body">
                <p class="album-meta" x-text="album.school_year + (album.class_label ? ' · kl. '+album.class_label : '')"></p>
                <p class="album-title" x-text="album.title"></p>
              </div>
            </a>
          </template>
        </div>
      </template>
    </div>
  </template>

  <!-- Widok albumu -->
  <template x-if="currentAlbum">
    <div>
      <button @click="currentAlbum=null;currentPhotos=[]" style="font-family:var(--font-d);font-size:.85rem;font-weight:700;color:var(--cp);margin-bottom:1.5rem;cursor:pointer;background:none;border:none;padding:0">← Wróć do galerii</button>
      <h2 style="font-family:var(--font-d);font-size:1.5rem;font-weight:800;color:var(--tx);margin-bottom:.5rem" x-text="currentAlbum.title"></h2>
      <p style="font-size:.85rem;color:var(--tx-m);margin-bottom:1.5rem" x-text="currentAlbum.school_year + (currentAlbum.class_label ? ' · klasa '+currentAlbum.class_label : '') + (currentAlbum.event_date ? ' · '+fmtDate(currentAlbum.event_date) : '')"></p>
      <template x-if="photosLoading">
        <div class="photo-grid">
          <template x-for="i in 9" :key="i">
            <div style="aspect-ratio:1;background:var(--clv);border-radius:var(--r-s);animation:pulse 1.5s ease-in-out infinite"></div>
          </template>
        </div>
      </template>
      <template x-if="!photosLoading">
        <div class="photo-grid">
          <template x-for="photo in currentPhotos" :key="photo.id">
            <img :src="photo.thumb_url" :alt="currentAlbum.title" class="photo-thumb" loading="lazy"
                 @click="window.open(photo.url,'_blank')">
          </template>
        </div>
      </template>
    </div>
  </template>

</div>
</div>
<script>
function galleryApp(){
  return{
    albums:[],loading:true,
    currentAlbum:null,currentPhotos:[],photosLoading:false,
    async load(){
      try{
        const r=await fetch('/api/public/gallery');
        if(!r.ok)throw new Error();
        const d=await r.json();
        this.albums=d.albums;
      }catch{}
      finally{this.loading=false}
    },
    async openAlbum(slug){
      this.photosLoading=true;
      try{
        const r=await fetch('/api/public/gallery/'+slug);
        if(!r.ok)throw new Error();
        const d=await r.json();
        this.currentAlbum=d.album;
        this.currentPhotos=d.photos;
      }catch{}
      finally{this.photosLoading=false}
    },
    fmtDate(iso){
      if(!iso)return'';
      return new Date(iso).toLocaleDateString('pl-PL',{day:'numeric',month:'long',year:'numeric'});
    }
  }
}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Zastąp zawartość `_src/pages/jadlospis.html`**

```html
{% extends "_base.html" %}
{% block page_title %}Jadłospis{% endblock %}
{% block eyebrow %}Stołówka szkolna{% endblock %}
{% block hero_title %}Jadłospis{% endblock %}
{% block breadcrumb_page %}Jadłospis{% endblock %}
{% block page_css %}
<style>
.menu-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);padding:2rem;margin-top:2rem;text-align:center;box-shadow:var(--sh)}
.menu-card p{color:var(--tx-m);margin-bottom:1rem;font-size:.95rem}
.menu-week{font-family:var(--font-d);font-size:1.1rem;font-weight:800;color:var(--tx);margin-bottom:1rem}
.menu-btn{display:inline-flex;align-items:center;gap:.5rem;font-family:var(--font-d);font-weight:700;font-size:.95rem;padding:.75rem 1.75rem;border-radius:var(--r-s);background:var(--cp);color:#fff;text-decoration:none;transition:background var(--tr)}
.menu-btn:hover{background:var(--ca)}
.menu-empty{background:var(--clv-l);border:1px dashed var(--bd);border-radius:var(--r);padding:2.5rem;margin-top:2rem;text-align:center}
.menu-empty p{color:var(--tx-m);font-size:.95rem}
</style>
{% endblock %}
{% block content %}
<div class="container page-main">
<div x-data="menuApp()" x-init="load()">
  <template x-if="loading">
    <div style="background:var(--clv);border-radius:var(--r);height:200px;animation:pulse 1.5s ease-in-out infinite;margin-top:2rem"></div>
  </template>
  <template x-if="!loading && menu">
    <div class="menu-card">
      <p class="menu-week" x-text="'Tydzień: ' + fmtWeek(menu.week_start)"></p>
      <p>Kliknij poniżej, aby otworzyć jadłospis na bieżący tydzień.</p>
      <a :href="menu.url" target="_blank" rel="noopener" class="menu-btn">📋 Otwórz jadłospis (PDF)</a>
      <p x-show="menu.notes" x-text="menu.notes" style="margin-top:1rem;font-size:.85rem;color:var(--tx-m)"></p>
    </div>
  </template>
  <template x-if="!loading && !menu">
    <div class="menu-empty">
      <p>Jadłospis na bieżący tydzień nie został jeszcze opublikowany.</p>
      <p style="margin-top:.5rem">Sprawdź ponownie w poniedziałek rano lub skontaktuj się ze stołówką.</p>
    </div>
  </template>
</div>
</div>
<script>
function menuApp(){
  return{
    menu:null,loading:true,
    async load(){
      try{
        const r=await fetch('/api/public/menu/current');
        if(!r.ok)throw new Error();
        const d=await r.json();
        this.menu=d.menu;
      }catch{}
      finally{this.loading=false}
    },
    fmtWeek(iso){
      if(!iso)return'';
      const d=new Date(iso);
      const end=new Date(d);end.setDate(end.getDate()+4);
      const fmt=dt=>dt.toLocaleDateString('pl-PL',{day:'numeric',month:'long'});
      return fmt(d)+' – '+fmt(end)+' '+end.getFullYear();
    }
  }
}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Przebuduj i przetestuj**

```bash
python3 build.py
```

Sprawdź `http://localhost:8788/galeria.html` — powinien pokazać grid albumów (pusty) lub komunikat.  
Sprawdź `http://localhost:8788/jadlospis.html` — powinien pokazać komunikat o braku jadłospisu.

- [ ] **Commit**

```bash
git add _src/pages/galeria.html _src/pages/jadlospis.html galeria.html jadlospis.html
git commit -m "feat: galeria + jadlospis as dynamic alpine shells"
```

---

## Task 10: Dynamiczne strony specjalistów

**Files:**
- Modify: `_src/pages/psycholog.html`
- Modify: `_src/pages/pedagog.html`
- Modify: `_src/pages/doradca.html`
- Modify: `_src/pages/pielegnarka.html`

Każda strona fetchuje `/api/public/specialists` i filtruje po `role`. Wzorzec jest identyczny — poniżej pełna implementacja dla `psycholog.html`, pozostałe różnią się tylko wartością `ROLE` i tytułem.

- [ ] **Zastąp `_src/pages/psycholog.html`**

```html
{% extends "_base.html" %}
{% block page_title %}Psycholog szkolny{% endblock %}
{% block eyebrow %}Wsparcie psychologiczne{% endblock %}
{% block hero_title %}Psycholog szkolny{% endblock %}
{% block breadcrumb_page %}Psycholog szkolny{% endblock %}
{% block page_css %}
<style>
.page-main{padding:3rem 0 5rem}
.staff-card{background:var(--sf);border:1px solid var(--bd);border-left:3px solid var(--ca);border-radius:var(--r);padding:1.5rem;box-shadow:var(--sh);margin-bottom:2rem}
.staff-role{font-family:var(--font-d);font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ca);margin-bottom:.3rem}
.staff-name{font-family:var(--font-d);font-size:1.1rem;font-weight:700;color:var(--tx)}
.staff-note{font-size:.85rem;color:var(--tx-m);margin-top:.25rem}
.hours-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem;margin:1.25rem 0 2rem}
.hour-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);padding:1rem .75rem;text-align:center;box-shadow:var(--sh)}
.hour-day{font-family:var(--font-d);font-weight:700;font-size:.8rem;color:var(--tx-m);margin-bottom:.3rem}
.hour-time{font-family:var(--font-d);font-weight:800;font-size:1.05rem;color:var(--cp)}
.section-title{font-family:var(--font-d);font-size:1.4rem;font-weight:800;letter-spacing:-.02em;color:var(--tx);margin-bottom:1rem}
.section-sub{font-size:.95rem;color:var(--tx-m);margin-bottom:1.5rem;max-width:640px;line-height:1.7}
.contact-cta-strip{background:var(--cp);border-radius:var(--r);padding:1.5rem 2rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:2.5rem}
.contact-cta-strip p{font-family:var(--font-d);font-size:.95rem;color:rgba(255,255,255,.8)}
.contact-cta-strip a{font-family:var(--font-d);font-size:.9rem;font-weight:700;color:var(--ca)}
.skel{background:var(--clv);border-radius:var(--r);animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
</style>
{% endblock %}
{% block content %}
<div class="container" x-data="specialistApp('psycholog')" x-init="load()">

  <template x-if="loading">
    <div>
      <div class="skel" style="height:100px;margin-bottom:2rem"></div>
      <div class="hours-grid">
        <div class="skel" style="height:80px"></div>
        <div class="skel" style="height:80px"></div>
        <div class="skel" style="height:80px"></div>
      </div>
    </div>
  </template>

  <template x-if="!loading && specialist">
    <div>
      <div class="staff-card">
        <p class="staff-role" x-text="specialist.role === 'psycholog' ? 'Psycholog szkolny' : specialist.role"></p>
        <p class="staff-name" x-text="(specialist.title_prefix ? specialist.title_prefix + ' ' : '') + specialist.name"></p>
        <p class="staff-note" x-text="'Gabinet nr ' + (specialist.room ?? '—') + (specialist.phone_ext ? ' · tel. wew. ' + specialist.phone_ext : '')"></p>
      </div>

      <h2 class="section-title">Godziny pracy</h2>
      <div class="hours-grid">
        <template x-for="h in specialist.hours" :key="h.day">
          <div class="hour-card">
            <p class="hour-day" x-text="h.day"></p>
            <p class="hour-time" x-text="h.from + '–' + h.to"></p>
          </div>
        </template>
      </div>

      <div class="contact-cta-strip">
        <p>Chcesz umówić spotkanie lub masz pytanie?</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap">
          <a href="tel:+48322634301">32 263-43-01<span x-show="specialist.phone_ext" x-text="' wew. ' + specialist.phone_ext"></span></a>
          <a href="#" data-open-contact>Dane kontaktowe →</a>
        </div>
      </div>
    </div>
  </template>

</div>
<script>
function specialistApp(role){
  return{
    specialist:null,loading:true,
    async load(){
      try{
        const r=await fetch('/api/public/specialists');
        if(!r.ok)throw new Error();
        const d=await r.json();
        this.specialist=d.specialists.find(s=>s.role===role)||null;
      }catch{}
      finally{this.loading=false}
    }
  }
}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Utwórz `specialist-shared.css`** — wspólny CSS dla wszystkich 4 stron specjalistów

```css
/* specialist-shared.css — ładowany przez psycholog, pedagog, doradca, pielegnarka */
.page-main{padding:3rem 0 5rem}
.staff-card{background:var(--sf);border:1px solid var(--bd);border-left:3px solid var(--ca);border-radius:var(--r);padding:1.5rem;box-shadow:var(--sh);margin-bottom:2rem}
.staff-role{font-family:var(--font-d);font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ca);margin-bottom:.3rem}
.staff-name{font-family:var(--font-d);font-size:1.1rem;font-weight:700;color:var(--tx)}
.staff-note{font-size:.85rem;color:var(--tx-m);margin-top:.25rem}
.hours-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem;margin:1.25rem 0 2rem}
.hour-card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);padding:1rem .75rem;text-align:center;box-shadow:var(--sh)}
.hour-day{font-family:var(--font-d);font-weight:700;font-size:.8rem;color:var(--tx-m);margin-bottom:.3rem}
.hour-time{font-family:var(--font-d);font-weight:800;font-size:1.05rem;color:var(--cp)}
.section-title{font-family:var(--font-d);font-size:1.4rem;font-weight:800;letter-spacing:-.02em;color:var(--tx);margin-bottom:1rem}
.section-sub{font-size:.95rem;color:var(--tx-m);margin-bottom:1.5rem;max-width:640px;line-height:1.7}
.contact-cta-strip{background:var(--cp);border-radius:var(--r);padding:1.5rem 2rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:2.5rem}
.contact-cta-strip p{font-family:var(--font-d);font-size:.95rem;color:rgba(255,255,255,.8)}
.contact-cta-strip a{font-family:var(--font-d);font-size:.9rem;font-weight:700;color:var(--ca)}
.skel{background:var(--clv);border-radius:var(--r);animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
```

- [ ] **Zaktualizuj `_src/pages/psycholog.html`** — usuń inline `<style>` z `page_css`, dodaj link do shared CSS:

W bloku `{% block page_css %}` zastąp cały `<style>...</style>` na:
```html
{% block page_css %}
<link rel="stylesheet" href="/specialist-shared.css">
{% endblock %}
```

- [ ] **Zastąp `_src/pages/pedagog.html`** — pełna zawartość:

```html
{% extends "_base.html" %}
{% block page_title %}Pedagog szkolny{% endblock %}
{% block eyebrow %}Wsparcie uczniów i rodziców{% endblock %}
{% block hero_title %}Pedagog szkolny{% endblock %}
{% block breadcrumb_page %}Pedagog szkolny{% endblock %}
{% block page_css %}<link rel="stylesheet" href="/specialist-shared.css">{% endblock %}
{% block content %}
<div class="container" x-data="specialistApp('pedagog')" x-init="load()">
  <template x-if="loading">
    <div>
      <div class="skel" style="height:100px;margin-bottom:2rem"></div>
      <div class="hours-grid">
        <div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div>
      </div>
    </div>
  </template>
  <template x-if="!loading && specialist">
    <div>
      <div class="staff-card">
        <p class="staff-role">Pedagog szkolny / Pedagog specjalny</p>
        <p class="staff-name" x-text="(specialist.title_prefix ? specialist.title_prefix + ' ' : '') + specialist.name"></p>
        <p class="staff-note" x-text="'Gabinet nr ' + (specialist.room ?? '—') + (specialist.phone_ext ? ' · tel. wew. ' + specialist.phone_ext : '')"></p>
      </div>
      <h2 class="section-title">Godziny pracy</h2>
      <div class="hours-grid">
        <template x-for="h in specialist.hours" :key="h.day">
          <div class="hour-card"><p class="hour-day" x-text="h.day"></p><p class="hour-time" x-text="h.from + '–' + h.to"></p></div>
        </template>
      </div>
      <div class="contact-cta-strip">
        <p>Chcesz umówić spotkanie lub masz pytanie?</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap">
          <a href="tel:+48322634301">32 263-43-01<span x-show="specialist.phone_ext" x-text="' wew. ' + specialist.phone_ext"></span></a>
          <a href="#" data-open-contact>Dane kontaktowe →</a>
        </div>
      </div>
    </div>
  </template>
</div>
<script>
function specialistApp(role){return{specialist:null,loading:true,async load(){try{const r=await fetch('/api/public/specialists');if(!r.ok)throw new Error();const d=await r.json();this.specialist=d.specialists.find(s=>s.role===role)||null;}catch{}finally{this.loading=false}}}}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Zastąp `_src/pages/doradca.html`** — pełna zawartość:

```html
{% extends "_base.html" %}
{% block page_title %}Doradca zawodowy{% endblock %}
{% block eyebrow %}Orientacja zawodowa · Klasy IV–VIII{% endblock %}
{% block hero_title %}Doradca zawodowy{% endblock %}
{% block breadcrumb_page %}Doradca zawodowy{% endblock %}
{% block page_css %}<link rel="stylesheet" href="/specialist-shared.css">{% endblock %}
{% block content %}
<div class="container" x-data="specialistApp('doradca')" x-init="load()">
  <template x-if="loading">
    <div><div class="skel" style="height:100px;margin-bottom:2rem"></div><div class="hours-grid"><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div></div></div>
  </template>
  <template x-if="!loading && specialist">
    <div>
      <div class="staff-card">
        <p class="staff-role">Doradca zawodowy</p>
        <p class="staff-name" x-text="(specialist.title_prefix ? specialist.title_prefix + ' ' : '') + specialist.name"></p>
        <p class="staff-note" x-text="'Gabinet nr ' + (specialist.room ?? '—')"></p>
      </div>
      <h2 class="section-title">Godziny pracy</h2>
      <div class="hours-grid">
        <template x-for="h in specialist.hours" :key="h.day">
          <div class="hour-card"><p class="hour-day" x-text="h.day"></p><p class="hour-time" x-text="h.from + '–' + h.to"></p></div>
        </template>
      </div>
      <div class="contact-cta-strip">
        <p>Chcesz umówić poradę indywidualną?</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap">
          <a href="tel:+48322634301">32 263-43-01 (sekretariat)</a>
          <a href="#" data-open-contact>Dane kontaktowe →</a>
        </div>
      </div>
    </div>
  </template>
</div>
<script>
function specialistApp(role){return{specialist:null,loading:true,async load(){try{const r=await fetch('/api/public/specialists');if(!r.ok)throw new Error();const d=await r.json();this.specialist=d.specialists.find(s=>s.role===role)||null;}catch{}finally{this.loading=false}}}}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Zastąp `_src/pages/pielegnarka.html`** — pełna zawartość:

```html
{% extends "_base.html" %}
{% block page_title %}Pielęgniarka szkolna{% endblock %}
{% block eyebrow %}Opieka medyczna w szkole{% endblock %}
{% block hero_title %}Pielęgniarka szkolna{% endblock %}
{% block breadcrumb_page %}Pielęgniarka szkolna{% endblock %}
{% block page_css %}<link rel="stylesheet" href="/specialist-shared.css">{% endblock %}
{% block content %}
<div class="container" x-data="specialistApp('pielegnarka')" x-init="load()">
  <template x-if="loading">
    <div><div class="skel" style="height:100px;margin-bottom:2rem"></div><div class="hours-grid"><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div></div></div>
  </template>
  <template x-if="!loading && specialist">
    <div>
      <div class="staff-card">
        <p class="staff-role">Pielęgniarka dyplomowana</p>
        <p class="staff-name" x-text="specialist.name"></p>
        <p class="staff-note">Gabinet pielęgniarki · SP32 Sosnowiec</p>
      </div>
      <h2 class="section-title">Godziny pracy gabinetu</h2>
      <div class="hours-grid">
        <template x-for="h in specialist.hours" :key="h.day">
          <div class="hour-card"><p class="hour-day" x-text="h.day"></p><p class="hour-time" x-text="h.from + '–' + h.to"></p></div>
        </template>
      </div>
      <div class="contact-cta-strip">
        <p>Pytania dotyczące opieki zdrowotnej ucznia?</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap">
          <a href="tel:+48322634301">32 263-43-01 (sekretariat)</a>
          <a href="#" data-open-contact>Dane kontaktowe →</a>
        </div>
      </div>
    </div>
  </template>
</div>
<script>
function specialistApp(role){return{specialist:null,loading:true,async load(){try{const r=await fetch('/api/public/specialists');if(!r.ok)throw new Error();const d=await r.json();this.specialist=d.specialists.find(s=>s.role===role)||null;}catch{}finally{this.loading=false}}}}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Przebuduj**

```bash
python3 build.py
```

- [ ] **Przetestuj**

```
http://localhost:8788/psycholog.html
```
Powinny pojawić się godziny pracy Agnieszki Żak z seed data.

- [ ] **Commit**

```bash
git add _src/pages/psycholog.html _src/pages/pedagog.html _src/pages/doradca.html _src/pages/pielegnarka.html
git add psycholog.html pedagog.html doradca.html pielegnarka.html
git commit -m "feat: specialist pages as dynamic alpine shells (fetch from API)"
```

---

## Task 11: Nowa strona Dokumenty + aktualizacja nav

**Files:**
- Create: `_src/pages/dokumenty.html`
- Modify: `_src/_base.html` (nav + footer)
- Modify: `build.py`
- Modify: `sitemap.xml`

- [ ] **Utwórz `_src/pages/dokumenty.html`**

```html
{% extends "_base.html" %}
{% block page_title %}Dokumenty szkolne{% endblock %}
{% block eyebrow %}Dokumentacja i formularze{% endblock %}
{% block hero_title %}Dokumenty szkolne{% endblock %}
{% block breadcrumb_page %}Dokumenty szkolne{% endblock %}
{% block page_css %}
<style>
.page-main{padding:3rem 0 5rem}
.tabs{display:flex;gap:.25rem;border-bottom:2px solid var(--bd);margin-bottom:2rem;flex-wrap:wrap}
.tab-btn{font-family:var(--font-d);font-size:.8rem;font-weight:700;padding:.6rem 1rem;border-radius:var(--r-s) var(--r-s) 0 0;border:none;cursor:pointer;background:transparent;color:var(--tx-m);transition:color var(--tr),background var(--tr)}
.tab-btn.active,.tab-btn[aria-selected="true"]{background:var(--sf);color:var(--cp);border:2px solid var(--bd);border-bottom:2px solid var(--sf);margin-bottom:-2px}
.doc-list{display:flex;flex-direction:column;gap:.75rem}
.doc-item{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r-s);padding:1rem 1.25rem;display:flex;align-items:center;gap:1rem;box-shadow:var(--sh);transition:box-shadow var(--tr)}
.doc-item:hover{box-shadow:var(--sh-m)}
.doc-icon{font-size:1.25rem;flex-shrink:0}
.doc-title{font-family:var(--font-d);font-weight:700;font-size:.9rem;color:var(--tx);flex:1}
.doc-meta{font-size:.75rem;color:var(--tx-m)}
.doc-link{display:inline-flex;align-items:center;gap:.3rem;font-family:var(--font-d);font-size:.78rem;font-weight:700;color:var(--cp);flex-shrink:0;padding:.35rem .75rem;border-radius:var(--r-s);border:1px solid var(--bd);transition:color var(--tr),background var(--tr)}
.doc-link:hover{background:var(--cp);color:#fff}
.skel{background:var(--clv);border-radius:var(--r-s);animation:pulse 1.5s ease-in-out infinite;height:64px;margin-bottom:.75rem}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.empty-note{color:var(--tx-m);font-size:.95rem;padding:2rem 0}
</style>
{% endblock %}
{% block content %}
<div class="container" x-data="docsApp()" x-init="load()">

  <div class="tabs" role="tablist">
    <button class="tab-btn" :class="{active:tab==='dokumenty'}" @click="switchTab('dokumenty')" role="tab">Dokumenty szkolne</button>
    <button class="tab-btn" :class="{active:tab==='druki'}" @click="switchTab('druki')" role="tab">Druki do pobrania</button>
    <button class="tab-btn" :class="{active:tab==='rodo'}" @click="switchTab('rodo')" role="tab">RODO/IOD</button>
  </div>

  <template x-if="loading">
    <div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
  </template>

  <template x-if="!loading && items.length === 0">
    <p class="empty-note">Brak dokumentów w tej kategorii.</p>
  </template>

  <template x-if="!loading && items.length > 0">
    <div class="doc-list">
      <template x-for="doc in items" :key="doc.id">
        <div class="doc-item">
          <span class="doc-icon" x-text="doc.file_type === 'docx' ? '📝' : '📄'"></span>
          <div style="flex:1;min-width:0">
            <p class="doc-title" x-text="doc.title"></p>
            <p class="doc-meta" x-text="doc.file_type ? doc.file_type.toUpperCase() + (doc.file_size ? ' · ' + fmtSize(doc.file_size) : '') : ''"></p>
          </div>
          <a :href="doc.url" target="_blank" rel="noopener" class="doc-link">Pobierz ↗</a>
        </div>
      </template>
    </div>
  </template>

</div>
<script>
function docsApp(){
  return{
    tab:'dokumenty',items:[],loading:true,
    async load(){
      this.loading=true;
      try{
        const r=await fetch('/api/public/documents/'+this.tab);
        if(!r.ok)throw new Error();
        const d=await r.json();
        this.items=d.documents;
      }catch{this.items=[]}
      finally{this.loading=false}
    },
    switchTab(t){this.tab=t;this.load()},
    fmtSize(bytes){
      if(bytes<1024)return bytes+'B';
      if(bytes<1048576)return Math.round(bytes/1024)+'KB';
      return(bytes/1048576).toFixed(1)+'MB';
    }
  }
}
</script>
<script src="/alpine.min.js" defer></script>
{% endblock %}
```

- [ ] **Dodaj `dokumenty` do `build.py`**

```python
# W sekcji # ── Rodzice, po rada-rodzicow:
("dokumenty.html", "dokumenty.html", {
    "breadcrumb_section": "Rodzice",
    "active_nav": "rodzice",
}),
```

- [ ] **Dodaj do nawigacji w `_src/_base.html`** — do Rodzice dropdown (po psycholog):

```html
<li><a href="dokumenty.html" class="dropdown-item" role="menuitem"><span class="di-icon" style="font-size:1rem;display:flex;align-items:center;justify-content:center">📄</span>Dokumenty szkolne</a></li>
```

Dodaj też do mobile drawera i footer chip-cloud (`<a href="dokumenty.html" class="footer-chip">Dokumenty szkolne</a>`).

- [ ] **Dodaj do `sitemap.xml`**

```xml
<url><loc>https://sp32sosnowiec.pl/dokumenty.html</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
```

- [ ] **Przebuduj**

```bash
python3 build.py
```

- [ ] **Przetestuj**

```
http://localhost:8788/dokumenty.html
```
Powinny pojawić się 3 zakładki, każda ładuje z API (pusto — OK na razie).

- [ ] **Commit**

```bash
git add _src/pages/dokumenty.html _src/_base.html build.py sitemap.xml
git add dokumenty.html
git commit -m "feat: add dokumenty.html dynamic page with tabs, add to nav"
```

---

## Task 12: Deploy na Cloudflare + migracja produkcyjna

**Files:**
- Modify: `wrangler.toml` (dodaj database_id z kroku wrangler d1 create)

- [ ] **Uruchom migrację na produkcję**

```bash
npm run db:migrate:remote
```

Oczekiwany output: `✅ Applied 1 migration(s)`

- [ ] **Wgraj seed specjalistów na produkcję**

```bash
wrangler d1 execute sp32-db --remote --command "
INSERT OR IGNORE INTO specialists (role, name, title_prefix, room, phone_ext, hours) VALUES
  ('psycholog','Agnieszka Żak','mgr','21',NULL,'[{\"day\":\"Poniedziałek\",\"from\":\"8:00\",\"to\":\"15:40\"},{\"day\":\"Wtorek\",\"from\":\"8:00\",\"to\":\"15:40\"},{\"day\":\"Środa\",\"from\":\"10:00\",\"to\":\"16:00\"},{\"day\":\"Czwartek\",\"from\":\"8:00\",\"to\":\"15:00\"},{\"day\":\"Piątek\",\"from\":\"8:00\",\"to\":\"13:00\"}]'),
  ('pedagog','Edyta Kołton','mgr','20','24','[{\"day\":\"Poniedziałek\",\"from\":\"8:00\",\"to\":\"15:40\"},{\"day\":\"Wtorek\",\"from\":\"8:50\",\"to\":\"15:40\"},{\"day\":\"Środa\",\"from\":\"10:30\",\"to\":\"16:00\"},{\"day\":\"Czwartek\",\"from\":\"8:00\",\"to\":\"12:00\"},{\"day\":\"Piątek\",\"from\":\"8:00\",\"to\":\"13:00\"}]'),
  ('doradca','Dorota Zalas','mgr','06',NULL,'[{\"day\":\"Wtorek\",\"from\":\"13:00\",\"to\":\"16:00\"},{\"day\":\"Środa\",\"from\":\"8:00\",\"to\":\"15:00\"}]'),
  ('pielegnarka','Agnieszka Gnacik',NULL,NULL,NULL,'[{\"day\":\"Wtorek\",\"from\":\"7:30\",\"to\":\"11:30\"},{\"day\":\"Środa\",\"from\":\"11:00\",\"to\":\"15:00\"},{\"day\":\"Czwartek\",\"from\":\"11:00\",\"to\":\"15:00\"},{\"day\":\"Piątek\",\"from\":\"7:30\",\"to\":\"15:00\"}]');
"
```

- [ ] **Deploy na Cloudflare Pages**

```bash
git push origin main
```

Cloudflare Pages automatycznie buduje i deployuje po każdym push na `main`.  
Lub ręcznie: `npm run deploy`

- [ ] **Przetestuj produkcję**

```bash
curl https://sp32sosnowiec.pl/api/public/specialists | python3 -m json.tool
```
Oczekiwany output: JSON z 4 specjalistami.

```bash
curl https://sp32sosnowiec.pl/api/health
```
Oczekiwany output: `{"ok":true,...}`

- [ ] **Final commit**

```bash
git add wrangler.toml
git commit -m "chore: add production D1 database_id to wrangler.toml"
git push origin main
```

---

## Weryfikacja końcowa Planu 1

- [ ] `GET /api/public/news` zwraca JSON ✓
- [ ] `GET /api/public/gallery` zwraca JSON ✓
- [ ] `GET /api/public/documents/dokumenty` zwraca JSON (lub pusty array) ✓
- [ ] `GET /api/public/specialists` zwraca 4 specjalistów z godzinami ✓
- [ ] `GET /api/public/menu/current` zwraca null lub menu ✓
- [ ] `aktualnosci.html` — Alpine ładuje newsy, loader widoczny, fallback na błąd ✓
- [ ] `artykul.html?slug=X` — Alpine ładuje artykuł po slug ✓
- [ ] `galeria.html` — Alpine ładuje albumy, klik otwiera zdjęcia ✓
- [ ] `jadlospis.html` — stan pusty lub PDF link ✓
- [ ] `psycholog/pedagog/doradca/pielegnarka.html` — godziny z API ✓
- [ ] `dokumenty.html` — zakładki ładują z API ✓
- [ ] Testy przechodzą: `npm test` → 4 passed ✓

---

**Plan 2** (Admin API + Admin UI + RODO Cron) zapisany zostanie oddzielnie po ukończeniu Planu 1.
