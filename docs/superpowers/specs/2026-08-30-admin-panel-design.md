# Design: Mini Panel Admina SP32

**Data:** 2026-08-30  
**Status:** Zatwierdzony przez użytkownika  
**Projekt:** sp32sosnowiec-website  

---

## 1. Kontekst i cel

Szkoła Podstawowa nr 32 w Sosnowcu potrzebuje panelu administracyjnego do zarządzania treściami strony sp32sosnowiec.pl. Strona jest hostowana na Cloudflare Pages jako statyczny SSG (Jinja2). Panel ma umożliwić aktualizację treści dynamicznych bez wiedzy technicznej i bez przebudowania całej strony.

---

## 2. Architektura — Hybrid Shell (Arch B)

Wybrana architektura: **statyczna powłoka + JS fetch z Pages Functions API**.

```
sp32sosnowiec.pl
  /              →  statyczny HTML (Jinja2 SSG, bez zmian)
  /admin/*       →  chronione przez Cloudflare Access (HTML + Alpine.js)
  /api/public/*  →  Pages Functions, publiczne, CDN-cached
  /api/admin/*   →  Pages Functions, chronione JWT Access
                          ↓
                    D1 (metadata) + R2 (pliki)
```

Jedno repo, jeden deploy (`git push` → Pages buduje wszystko).  
Cloudflare Access blokuje `/admin/*` na poziomie sieci przed dotarciem do kodu.

---

## 3. Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Hosting | Cloudflare Pages |
| API | Pages Functions (TypeScript + Hono.js) |
| Baza danych | Cloudflare D1 (SQLite at edge) |
| Pliki | Cloudflare R2 |
| Auth | Cloudflare Access + Google OAuth |
| Admin UI | Statyczne HTML + Alpine.js (self-hosted `/alpine.min.js`) |
| Main site interaktywność | Alpine.js (tylko na dynamicznych stronach) |
| Cron (RODO audit) | Cloudflare Cron Trigger |

---

## 4. Role użytkowników

| Rola | Kryterium | Dostęp |
|---|---|---|
| **Admin** | email = `sp32.tech@gmail.com` | wszystkie moduły |
| **Editor** | pozostałe emaile na liście Access | tylko: aktualności + galerie |

Weryfikacja roli: Worker odczytuje claim `email` z JWT tokenu Access (`CF-Access-Jwt-Assertion`). Endpointy tylko-Admin zwracają 403 dla Editorów.

Listą emaili Editorów zarządza Admin w dashboardzie Cloudflare Access — bez zmian w kodzie.

---

## 5. Schemat bazy danych (D1)

### `news`
```sql
CREATE TABLE news (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  excerpt       TEXT,
  body_html     TEXT,
  cover_r2_key  TEXT,
  published_at  TEXT,           -- NULL = szkic
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  author_email  TEXT
);
```

### `gallery_albums`
```sql
CREATE TABLE gallery_albums (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  school_year     TEXT NOT NULL,   -- "2024/2025"
  class_label     TEXT,            -- "3a" | NULL = ogólnoszkolne
  graduation_year INTEGER NOT NULL,
  -- auto-wyliczony przy tworzeniu albumu:
  --   jeśli class_label = "Xa" → graduation_year = school_year_end + (8 - X)
  --     np. klasa 3a, rok 2024/2025 → 2025 + (8-3) = 2030
  --   jeśli class_label = NULL (ogólnoszkolne) → graduation_year = school_year_end
  --     (najstarszy możliwy rocznik — klasa 8 danego roku)
  event_date      TEXT,            -- ISO date
  cover_r2_key    TEXT,
  published       INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
```

### `gallery_photos`
```sql
CREATE TABLE gallery_photos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id        INTEGER NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  r2_key          TEXT NOT NULL,
  r2_key_thumb    TEXT,
  consent_ref     TEXT,   -- sygnatura papierowej zgody w archiwum IOD
  graduation_year INTEGER, -- dziedziczy z albumu, można nadpisać per-zdjęcie
  anonymized      INTEGER DEFAULT 0,
  anonymized_at   TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
```

### `documents`
```sql
CREATE TABLE documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,  -- "dokumenty"|"zfss"|"druki"|"rodo"
  title       TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  file_type   TEXT,           -- "pdf"|"docx"
  file_size   INTEGER,
  sort_order  INTEGER DEFAULT 0,
  published   INTEGER DEFAULT 1,
  uploaded_at TEXT DEFAULT (datetime('now')),
  uploaded_by TEXT
);
```

### `specialists`
```sql
CREATE TABLE specialists (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  role      TEXT NOT NULL,  -- "psycholog"|"pedagog"|"doradca"|"pielegnarka"
  name      TEXT NOT NULL,
  title_prefix TEXT,
  room      TEXT,
  phone_ext TEXT,
  hours     TEXT NOT NULL,  -- JSON: [{"day":"Poniedziałek","from":"8:00","to":"15:40"}]
  active    INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### `menu_weeks`
```sql
CREATE TABLE menu_weeks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start  TEXT NOT NULL UNIQUE, -- ISO date, poniedziałek
  r2_key      TEXT,
  notes       TEXT,
  published   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

### `consent_requests` (wnioski RODO)
```sql
CREATE TABLE consent_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_name    TEXT NOT NULL,
  class_label     TEXT,
  graduation_year INTEGER,
  request_type    TEXT NOT NULL,  -- "withdrawal"|"deletion"
  requested_at    TEXT DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     TEXT,
  status          TEXT DEFAULT 'pending', -- "pending"|"in_progress"|"resolved"
  notes           TEXT
);
```

---

## 6. Model RODO (z Dokumentu 2 — retention model)

Każde zdjęcie i album ma `graduation_year` = rok, w którym rocznik **opuszcza szkołę** (klasa 8 → rok szkolny end + 0).

**Formuła:** `T_audit = graduation_year + ΔY`

| ΔY | Trigger | Akcja |
|---|---|---|
| 0 | Rocznik opuścił szkołę | Pierwsze przypomnienie retencyjne |
| 3 | Rocznik osiągnął pełnoletność (18 lat) | Weryfikacja autonomii RODO absolwentów |

**Cron Trigger:** 1 września każdego roku, 8:00 UTC  
`cron = "0 8 1 9 *"`  

Worker wysyła email na `sp32.tech@gmail.com` z listą albumów spełniających warunek `graduation_year <= current_year` lub `graduation_year + 3 <= current_year`.

**Anonimizacja:** Admin pobiera zdjęcie → rozmywa twarz zewnętrznym narzędziem → wgrywa z powrotem → oznacza `anonymized = 1` w panelu. Brak wbudowanego modułu rozmycia (out of scope).

**`consent_ref`:** sygnatura papierowej zgody z archiwum szkolnego IOD. Przechowywana w D1, nie zbieramy zgód cyfrowo.

---

## 7. Struktura R2

Bucket: `sp32-media`

```
sp32-media/
├── news/covers/{slug}-{ts}.webp
├── news/images/{slug}-{ts}-{n}.webp
├── gallery/{album-slug}/cover.webp
├── gallery/{album-slug}/{photo-id}.webp
├── gallery/{album-slug}/{photo-id}_thumb.webp
├── documents/dokumenty/{ts}-{slug}.pdf
├── documents/zfss/{ts}-{slug}.pdf        ← nie-publiczne
├── documents/druki/{ts}-{slug}.pdf
├── documents/rodo/{ts}-{slug}.pdf
└── menu/{YYYY-MM-DD}.pdf
```

Public access: wszystkie prefiksy oprócz `documents/zfss/`.  
ZFŚS: serwowane przez Worker z weryfikacją roli Admin (dotyczy zarówno odczytu jak i zapisu — Editorzy nie mają dostępu do plików ZFŚS).  
Custom domain na bucket: `pub.sp32sosnowiec.pl`  
Cache na plikach R2: `max-age=31536000, immutable` (klucz zawiera timestamp).

---

## 8. API Routes

### Publiczne (`/api/public/*`)
Cache-Control: `public, s-maxage=300, stale-while-revalidate=60`

```
GET /api/public/news
GET /api/public/news/:slug
GET /api/public/gallery
GET /api/public/gallery/:slug
GET /api/public/documents/:category
GET /api/public/specialists
GET /api/public/menu/current
```

### Admin (`/api/admin/*`)
Wymaga ważnego `CF-Access-Jwt-Assertion`. Endpoint z ⭐ wymaga roli Admin.

```
POST   /api/admin/news
PUT    /api/admin/news/:id
DELETE /api/admin/news/:id

POST   /api/admin/gallery/albums
POST   /api/admin/gallery/albums/:id/photos   (multipart)
DELETE /api/admin/gallery/photos/:id
PUT    /api/admin/gallery/photos/:id/anonymize

POST   /api/admin/documents           ⭐ (multipart)
DELETE /api/admin/documents/:id       ⭐
PUT    /api/admin/documents/:id       ⭐

PUT    /api/admin/specialists/:role   ⭐

POST   /api/admin/menu                ⭐ (multipart)
DELETE /api/admin/menu/:id            ⭐

GET    /api/admin/rodo/requests       ⭐
POST   /api/admin/rodo/requests       ⭐
PUT    /api/admin/rodo/requests/:id   ⭐
GET    /api/admin/rodo/audit          ⭐
```

Po każdym zapisie: Worker wywołuje `caches.delete()` dla powiązanych publicznych URL-i.

---

## 9. Admin UI — struktura ekranów

```
/admin/index.html          Dashboard (statystyki, alerty RODO)
/admin/news/index.html     Lista aktualności + edytor (drawer)
/admin/gallery/index.html  Albumy + upload zdjęć
/admin/documents/index.html  Dokumenty wg kategorii  [Admin]
/admin/specialists/index.html  Godziny specjalistów  [Admin]
/admin/menu/index.html       Jadłospis tygodniowy    [Admin]
/admin/rodo/index.html       Wnioski + audit         [Admin]
```

Wspólny layout: sidebar nav z rolowym filtrem (Editor widzi: Aktualności, Galerie), nagłówek z emailem zalogowanego, tokeny CSS z `tokens.css`.

Alpine.js: self-hosted `/alpine.min.js`, ładowany tylko na stronach admina i dynamicznych stronach głównych.

---

## 10. Integracja z główną stroną — strony dynamiczne

Strony stające się powłokami (shell) z fetch:

| Plik | Endpoint | Fallback |
|---|---|---|
| `aktualnosci.html` | `/api/public/news` | "Treść chwilowo niedostępna. Odśwież stronę." |
| `artykul.html?slug=` | `/api/public/news/:slug` | redirect → aktualnosci.html |
| `galeria.html` | `/api/public/gallery` | j.w. |
| `jadlospis.html` | `/api/public/menu/current` | "Jadłospis na ten tydzień nie został jeszcze dodany." |
| `psycholog/pedagog/doradca/pielegnarka.html` | `/api/public/specialists` | statyczny HTML (ostatnia linia) |
| **`dokumenty.html`** (nowa) | `/api/public/documents/:category` | j.w. |

Pattern: Alpine.js x-data z `loading`, `error`, `items`. Skeleton CSS podczas ładowania. Dane cache'owane 5 min na Cloudflare CDN.

Nowa strona `dokumenty.html` wchodzi do nav → Rodzice dropdown jako "Dokumenty szkolne". Zawiera 4 zakładki: Dokumenty | Druki | ZFŚS | RODO/IOD.

---

## 11. Pliki i deploymenty — co się zmienia w repo

```
sp32sosnowiec-website/
├── functions/
│   └── api/
│       └── [[catchall]].ts     ← Hono.js, cały routing API
├── admin/                      ← nowy katalog
│   ├── index.html
│   ├── news/index.html
│   ├── gallery/index.html
│   ├── documents/index.html
│   ├── specialists/index.html
│   ├── menu/index.html
│   └── rodo/index.html
├── alpine.min.js               ← self-hosted Alpine
├── wrangler.toml               ← D1 binding, R2 binding, Cron Trigger
├── _src/pages/dokumenty.html   ← nowy szablon Jinja2 (shell)
└── docs/superpowers/specs/
    └── 2026-08-30-admin-panel-design.md
```

`wrangler.toml` kluczowe bindingsy:
```toml
[[d1_databases]]
binding = "DB"
database_name = "sp32-db"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "sp32-media"

[[triggers.crons]]
cron = "0 8 1 9 *"
```

---

## 12. Poza zakresem (out of scope)

- Wbudowany moduł rozmycia twarzy (anonimizacja ręcznie zewnętrznym narzędziem)
- Cyfrowe zbieranie zgód (5-toggleowy formularz z Dokumentu 1)
- Strefa Rodzica za logowaniem
- Skrzynka Zaufania
- Wyszukiwarka dokumentów HTML (zamiast PDF)
- Powiadomienia push / email dla rodziców
