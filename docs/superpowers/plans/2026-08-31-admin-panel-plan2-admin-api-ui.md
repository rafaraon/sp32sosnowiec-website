# Admin Panel — Plan 2: Admin API + Admin UI + RODO Cron

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Dodać kompletne admin API (`/api/admin/*`), panel UI (`/admin/*.html`) i oddzielny Worker RODO Cron. Po ukończeniu admin może logować się przez Cloudflare Access i zarządzać treścią: aktualności, galeria, dokumenty, specjaliści, jadłospis, wnioski RODO. Plan 1 musi być ukończony przed rozpoczęciem tego planu.

**Spec:** `docs/superpowers/specs/2026-08-30-admin-panel-design.md`

**Kontekst (stan po Planie 1):**
- `functions/api/[[catchall]].ts` — Hono entry point, export `onRequest`
- `functions/_lib/types.ts` — Env, wszystkie Row interfaces, calcGraduationYear
- `functions/_lib/db.ts` — serializers (newsToJson, albumToJson itd.)
- `functions/_lib/r2.ts` — r2Key, uploadToR2, deleteFromR2
- `functions/_lib/middleware/cache.ts` — Cache-Control na public endpoints
- `functions/_lib/routes/public.ts` — wszystkie GET /api/public/* routes
- `migrations/0001_initial.sql` — 7 tabel, zaaplikowane lokalnie i remote
- `alpine.min.js` — self-hosted Alpine 3.14.9 w root
- Env vars w CF Pages: `ADMIN_EMAIL=sp32.tech@gmail.com`, `ADMIN_SECRET` (secret), `MEDIA_PUBLIC_URL`
- D1: `sp32-db` (database_id: `6d53c13a-f432-4deb-aa98-fe7186261c9c`)
- R2: `sp32-media`
- CF Pages projekt: `sp32sosnowiec` (URL: `sp32sosnowiec-website.pages.dev`)

**Auth model:**
- Cloudflare Access blokuje `/admin/*` na poziomie sieci (konfiguracja ręczna w dashboardzie CF — poza zakresem planu)
- Workers odczytują `CF-Access-Jwt-Assertion` header → dekodują payload base64 → wyciągają `email` claim
- Rola: `email === ADMIN_EMAIL` → `admin`, reszta → `editor`
- Local dev bypass: jeśli `X-Admin-Secret: ${ADMIN_SECRET}` + `X-Admin-Email: <email>` → pomijamy JWT
- Endpointy oznaczone `[Admin]` zwracają `403` dla roli `editor`

**Nowe env vars wymagane (dodać w CF Pages Settings → Variables):**
- `ADMIN_SECRET` — już ustawiony jako secret
- (opcjonalnie w przyszłości: `RESEND_API_KEY` dla email w Worker RODO)

---

## Struktura plików (nowe/zmienione)

```
sp32sosnowiec/
├── functions/
│   └── _lib/
│       ├── auth.ts                    ← NOWY: JWT parse + rola
│       └── routes/
│           └── admin.ts               ← NOWY: wszystkie /api/admin/* routes
├── migrations/
│   └── 0002_rodo_audit_log.sql        ← NOWY: tabela dla wyników cron
├── admin/
│   ├── _shared.css                    ← NOWY: wspólny CSS panelu
│   ├── _shared.js                     ← NOWY: wspólny JS (fetch helpers, auth)
│   ├── index.html                     ← NOWY: dashboard
│   ├── news/index.html                ← NOWY: lista + edytor aktualności
│   ├── gallery/index.html             ← NOWY: albumy + upload zdjęć
│   ├── documents/index.html           ← NOWY: dokumenty wg kategorii [Admin]
│   ├── specialists/index.html         ← NOWY: godziny specjalistów [Admin]
│   ├── menu/index.html                ← NOWY: jadłospis [Admin]
│   └── rodo/index.html                ← NOWY: wnioski + audit [Admin]
└── workers/
    └── rodo-cron/
        ├── index.ts                   ← NOWY: cron Worker
        └── wrangler.toml              ← NOWY: konfiguracja cron Worker
```

---

## Task 1: Admin auth middleware

**Files:**
- Create: `functions/_lib/auth.ts`
- Modify: `functions/_lib/types.ts` (dodaj `AdminUser` type i `ADMIN_SECRET` do Env)
- Modify: `functions/api/[[catchall]].ts` (dodaj adminRouter + auth middleware)

### Zakres

- [ ] **Rozszerz `Env` w `functions/_lib/types.ts`**

```typescript
export type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  ADMIN_EMAIL: string
  ADMIN_SECRET: string
  MEDIA_PUBLIC_URL: string
}

export type AdminRole = 'admin' | 'editor'

export interface AdminUser {
  email: string
  role: AdminRole
}
```

- [ ] **Utwórz `functions/_lib/auth.ts`**

```typescript
import type { Context, Next } from 'hono'
import type { Env, AdminUser, AdminRole } from './types'

function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(payload)
  } catch {
    return null
  }
}

export function resolveRole(email: string, adminEmail: string): AdminRole {
  return email === adminEmail ? 'admin' : 'editor'
}

export async function adminAuth(
  c: Context<{ Bindings: Env; Variables: { user: AdminUser } }>,
  next: Next
): Promise<Response> {
  // Local dev bypass
  const devSecret = c.req.header('x-admin-secret')
  if (devSecret && devSecret === c.env.ADMIN_SECRET) {
    const email = c.req.header('x-admin-email') ?? c.env.ADMIN_EMAIL
    c.set('user', { email, role: resolveRole(email, c.env.ADMIN_EMAIL) })
    return next()
  }

  // CF Access JWT
  const jwt = c.req.header('cf-access-jwt-assertion')
  if (!jwt) return c.json({ error: 'unauthorized' }, 401)

  const payload = jwtPayload(jwt)
  if (!payload || typeof payload['email'] !== 'string') {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const email = payload['email'] as string
  c.set('user', { email, role: resolveRole(email, c.env.ADMIN_EMAIL) })
  return next()
}

export function requireAdmin(
  c: Context<{ Bindings: Env; Variables: { user: AdminUser } }>,
  next: Next
): Promise<Response> {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return Promise.resolve(c.json({ error: 'forbidden' }, 403))
  return next()
}
```

- [ ] **Utwórz szkielet `functions/_lib/routes/admin.ts`**

```typescript
import { Hono } from 'hono'
import type { Env, AdminUser } from '../types'
import { adminAuth, requireAdmin } from '../auth'

type Variables = { user: AdminUser }

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// Auth middleware na wszystkich trasach
adminRouter.use('*', adminAuth)

// Health — sprawdzenie auth i roli
adminRouter.get('/me', (c) => {
  const user = c.get('user')
  return c.json({ email: user.email, role: user.role })
})

// Endpointy CRUD dodane w Task 2–5
```

- [ ] **Zaktualizuj `functions/api/[[catchall]].ts`** — dodaj adminRouter:

```typescript
import { adminRouter } from '../_lib/routes/admin'
// ...
app.route('/api/admin', adminRouter)
```

- [ ] **Przetestuj lokalnie**

```bash
npm run dev
# W nowym terminalu:
curl -H "X-Admin-Secret: $(cat .dev.vars | grep ADMIN_SECRET | cut -d= -f2)" \
     -H "X-Admin-Email: sp32.tech@gmail.com" \
     http://localhost:8788/api/admin/me
```
Oczekiwany output: `{"email":"sp32.tech@gmail.com","role":"admin"}`

```bash
curl http://localhost:8788/api/admin/me
```
Oczekiwany output: `{"error":"unauthorized"}` z HTTP 401

> **Uwaga:** Utwórz plik `.dev.vars` (gitignored) z `ADMIN_SECRET=your-secret-here` i `ADMIN_EMAIL=sp32.tech@gmail.com` dla lokalnego devu. Dodaj `.dev.vars` do `.gitignore` jeśli go tam nie ma.

- [ ] **Commit**

```bash
git add functions/ .gitignore
git commit -m "feat: admin auth middleware (CF Access JWT + local dev bypass)"
```

---

## Task 2: Admin API — aktualności

**Files:**
- Modify: `functions/_lib/routes/admin.ts`

Endpointy:
- `POST /api/admin/news` — utwórz aktualność (Editor+Admin)
- `PUT /api/admin/news/:id` — edytuj (Editor+Admin)  
- `DELETE /api/admin/news/:id` — usuń (Editor+Admin)

### Zakres

- [ ] **Dodaj endpointy aktualności do `admin.ts`**

```typescript
import { newsToJson } from '../db'
import type { NewsRow } from '../types'

// POST /api/admin/news
adminRouter.post('/news', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{
    title: string
    slug: string
    excerpt?: string
    body_html?: string
    cover_r2_key?: string
    published_at?: string
  }>()

  if (!body.title || !body.slug) return c.json({ error: 'title and slug required' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO news (title, slug, excerpt, body_html, cover_r2_key, published_at, author_email)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(body.title, body.slug, body.excerpt ?? null, body.body_html ?? null,
    body.cover_r2_key ?? null, body.published_at ?? null, user.email)
    .first<NewsRow>()

  if (!result) return c.json({ error: 'insert failed' }, 500)
  return c.json({ item: newsToJson(result, c.env) }, 201)
})

// PUT /api/admin/news/:id
adminRouter.put('/news/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<Partial<{
    title: string; slug: string; excerpt: string; body_html: string;
    cover_r2_key: string; published_at: string
  }>>()

  const existing = await c.env.DB.prepare('SELECT id FROM news WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'not found' }, 404)

  const sets: string[] = []
  const vals: unknown[] = []
  const allowed = ['title','slug','excerpt','body_html','cover_r2_key','published_at'] as const
  for (const key of allowed) {
    if (key in body) { sets.push(`${key} = ?`); vals.push((body as any)[key] ?? null) }
  }
  if (!sets.length) return c.json({ error: 'no fields to update' }, 400)
  sets.push("updated_at = datetime('now')")
  vals.push(id)

  const updated = await c.env.DB.prepare(
    `UPDATE news SET ${sets.join(', ')} WHERE id = ? RETURNING *`
  ).bind(...vals).first<NewsRow>()

  return c.json({ item: newsToJson(updated!, c.env) })
})

// DELETE /api/admin/news/:id
adminRouter.delete('/news/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT cover_r2_key FROM news WHERE id = ?').bind(id).first<{cover_r2_key:string|null}>()
  if (!row) return c.json({ error: 'not found' }, 404)

  if (row.cover_r2_key) await c.env.MEDIA.delete(row.cover_r2_key)
  await c.env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})
```

- [ ] **Przetestuj lokalnie**

```bash
# Utwórz aktualność
curl -X POST http://localhost:8788/api/admin/news \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <secret>" \
  -H "X-Admin-Email: sp32.tech@gmail.com" \
  -d '{"title":"Test admin","slug":"test-admin","excerpt":"Krótki opis","published_at":"2026-08-31T12:00:00"}'
# Oczekiwany: HTTP 201, JSON z nową aktualnością

# Sprawdź publiczne API
curl http://localhost:8788/api/public/news
# Oczekiwany: zawiera nową aktualność

# Usuń
curl -X DELETE http://localhost:8788/api/admin/news/2 \
  -H "X-Admin-Secret: <secret>" -H "X-Admin-Email: sp32.tech@gmail.com"
# Oczekiwany: {"ok":true}
```

- [ ] **Commit**

```bash
git add functions/_lib/routes/admin.ts
git commit -m "feat: admin API CRUD for aktualnosci"
```

---

## Task 3: Admin API — galeria

**Files:**
- Modify: `functions/_lib/routes/admin.ts`

Endpointy:
- `POST /api/admin/gallery/albums` — utwórz album (Editor+Admin)
- `POST /api/admin/gallery/albums/:id/photos` — upload zdjęć multipart (Editor+Admin)
- `DELETE /api/admin/gallery/photos/:id` — usuń zdjęcie (Editor+Admin)
- `PUT /api/admin/gallery/photos/:id/anonymize` — oznacz jako zanonimizowane (Editor+Admin)
- `PUT /api/admin/gallery/albums/:id` — edytuj metadane albumu (Editor+Admin)
- `DELETE /api/admin/gallery/albums/:id` — usuń album + zdjęcia (Editor+Admin)

### Zakres

- [ ] **Dodaj endpointy galerii do `admin.ts`**

```typescript
import { albumToJson, photoToJson } from '../db'
import { r2Key, uploadToR2, deleteFromR2 } from '../r2'
import { calcGraduationYear } from '../types'
import type { GalleryAlbumRow, GalleryPhotoRow } from '../types'

// POST /api/admin/gallery/albums
adminRouter.post('/gallery/albums', async (c) => {
  const body = await c.req.json<{
    title: string; slug: string; school_year: string;
    class_label?: string; event_date?: string
  }>()
  if (!body.title || !body.slug || !body.school_year) {
    return c.json({ error: 'title, slug, school_year required' }, 400)
  }
  const graduation_year = calcGraduationYear(body.school_year, body.class_label ?? null)
  const row = await c.env.DB.prepare(
    `INSERT INTO gallery_albums (title, slug, school_year, class_label, graduation_year, event_date)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(body.title, body.slug, body.school_year, body.class_label ?? null,
    graduation_year, body.event_date ?? null).first<GalleryAlbumRow>()
  if (!row) return c.json({ error: 'insert failed' }, 500)
  return c.json({ album: albumToJson(row, c.env) }, 201)
})

// PUT /api/admin/gallery/albums/:id
adminRouter.put('/gallery/albums/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<Partial<{title:string;event_date:string;published:boolean;cover_r2_key:string}>>()
  const existing = await c.env.DB.prepare('SELECT id FROM gallery_albums WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'not found' }, 404)

  const sets: string[] = []; const vals: unknown[] = []
  if ('title' in body) { sets.push('title = ?'); vals.push(body.title) }
  if ('event_date' in body) { sets.push('event_date = ?'); vals.push(body.event_date ?? null) }
  if ('published' in body) { sets.push('published = ?'); vals.push(body.published ? 1 : 0) }
  if ('cover_r2_key' in body) { sets.push('cover_r2_key = ?'); vals.push(body.cover_r2_key ?? null) }
  if (!sets.length) return c.json({ error: 'no fields' }, 400)
  vals.push(id)
  const row = await c.env.DB.prepare(`UPDATE gallery_albums SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...vals).first<GalleryAlbumRow>()
  return c.json({ album: albumToJson(row!, c.env) })
})

// DELETE /api/admin/gallery/albums/:id
adminRouter.delete('/gallery/albums/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const photos = await c.env.DB.prepare('SELECT r2_key, r2_key_thumb FROM gallery_photos WHERE album_id = ?').bind(id).all<{r2_key:string;r2_key_thumb:string|null}>()
  for (const p of photos.results ?? []) {
    await c.env.MEDIA.delete(p.r2_key)
    if (p.r2_key_thumb) await c.env.MEDIA.delete(p.r2_key_thumb)
  }
  await c.env.DB.prepare('DELETE FROM gallery_albums WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// POST /api/admin/gallery/albums/:id/photos (multipart)
adminRouter.post('/gallery/albums/:id/photos', async (c) => {
  const albumId = Number(c.req.param('id'))
  const album = await c.env.DB.prepare('SELECT * FROM gallery_albums WHERE id = ?').bind(albumId).first<GalleryAlbumRow>()
  if (!album) return c.json({ error: 'album not found' }, 404)

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  const consentRef = formData.get('consent_ref') as string | null

  if (!file) return c.json({ error: 'file required' }, 400)

  const key = r2Key(`gallery/${album.slug}`, file.name)
  await uploadToR2(c.env, key, file)

  const maxOrder = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM gallery_photos WHERE album_id = ?'
  ).bind(albumId).first<{max_order:number}>()

  const row = await c.env.DB.prepare(
    `INSERT INTO gallery_photos (album_id, r2_key, consent_ref, graduation_year, sort_order)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  ).bind(albumId, key, consentRef ?? null, album.graduation_year,
    (maxOrder?.max_order ?? 0) + 1).first<GalleryPhotoRow>()

  return c.json({ photo: photoToJson(row!, c.env) }, 201)
})

// DELETE /api/admin/gallery/photos/:id
adminRouter.delete('/gallery/photos/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT r2_key, r2_key_thumb FROM gallery_photos WHERE id = ?').bind(id).first<{r2_key:string;r2_key_thumb:string|null}>()
  if (!row) return c.json({ error: 'not found' }, 404)
  await c.env.MEDIA.delete(row.r2_key)
  if (row.r2_key_thumb) await c.env.MEDIA.delete(row.r2_key_thumb)
  await c.env.DB.prepare('DELETE FROM gallery_photos WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// PUT /api/admin/gallery/photos/:id/anonymize
adminRouter.put('/gallery/photos/:id/anonymize', async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT id FROM gallery_photos WHERE id = ?').bind(id).first()
  if (!row) return c.json({ error: 'not found' }, 404)
  await c.env.DB.prepare(
    `UPDATE gallery_photos SET anonymized = 1, anonymized_at = datetime('now') WHERE id = ?`
  ).bind(id).run()
  return c.json({ ok: true })
})
```

- [ ] **Przetestuj album creation**

```bash
curl -X POST http://localhost:8788/api/admin/gallery/albums \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <secret>" -H "X-Admin-Email: sp32.tech@gmail.com" \
  -d '{"title":"Dzień Sportu 2026","slug":"dzien-sportu-2026","school_year":"2025/2026"}'
# Oczekiwany: HTTP 201, album z graduation_year: 2026
```

- [ ] **Commit**

```bash
git add functions/_lib/routes/admin.ts
git commit -m "feat: admin API CRUD for galeria (albums + photo upload)"
```

---

## Task 4: Admin API — moduły Admin-only (dokumenty, specjaliści, jadłospis)

**Files:**
- Modify: `functions/_lib/routes/admin.ts`

Endpointy (wszystkie wymagają roli `admin`):
- `POST /api/admin/documents` — upload dokumentu (multipart)
- `PUT /api/admin/documents/:id` — edytuj metadane
- `DELETE /api/admin/documents/:id` — usuń
- `PUT /api/admin/specialists/:role` — aktualizuj dane specjalisty
- `POST /api/admin/menu` — upload jadłospisu (multipart)
- `DELETE /api/admin/menu/:id` — usuń jadłospis

### Zakres

- [ ] **Dodaj import `requireAdmin` i endpointy admin-only**

```typescript
import { documentToJson, menuToJson, specialistToJson } from '../db'
import type { DocumentRow, MenuWeekRow, SpecialistRow } from '../types'

// POST /api/admin/documents [Admin]
adminRouter.post('/documents', requireAdmin, async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const title = form.get('title') as string | null
  const category = form.get('category') as string | null

  if (!file || !title || !category) return c.json({ error: 'file, title, category required' }, 400)
  const allowed = ['dokumenty','zfss','druki','rodo']
  if (!allowed.includes(category)) return c.json({ error: 'invalid category' }, 400)

  const key = r2Key(`documents/${category}`, file.name)
  await uploadToR2(c.env, key, file)

  const user = c.get('user')
  const row = await c.env.DB.prepare(
    `INSERT INTO documents (category, title, r2_key, file_type, file_size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(category, title, key,
    file.name.split('.').pop()?.toLowerCase() ?? null,
    file.size, user.email
  ).first<DocumentRow>()

  return c.json({ document: documentToJson(row!, c.env) }, 201)
})

// PUT /api/admin/documents/:id [Admin]
adminRouter.put('/documents/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<Partial<{title:string;sort_order:number;published:boolean}>>()
  const existing = await c.env.DB.prepare('SELECT id FROM documents WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'not found' }, 404)

  const sets: string[] = []; const vals: unknown[] = []
  if ('title' in body) { sets.push('title = ?'); vals.push(body.title) }
  if ('sort_order' in body) { sets.push('sort_order = ?'); vals.push(body.sort_order) }
  if ('published' in body) { sets.push('published = ?'); vals.push(body.published ? 1 : 0) }
  if (!sets.length) return c.json({ error: 'no fields' }, 400)
  vals.push(id)
  const row = await c.env.DB.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...vals).first<DocumentRow>()
  return c.json({ document: documentToJson(row!, c.env) })
})

// DELETE /api/admin/documents/:id [Admin]
adminRouter.delete('/documents/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT r2_key FROM documents WHERE id = ?').bind(id).first<{r2_key:string}>()
  if (!row) return c.json({ error: 'not found' }, 404)
  await c.env.MEDIA.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// PUT /api/admin/specialists/:role [Admin]
adminRouter.put('/specialists/:role', requireAdmin, async (c) => {
  const role = c.req.param('role')
  const valid = ['psycholog','pedagog','doradca','pielegnarka']
  if (!valid.includes(role)) return c.json({ error: 'invalid role' }, 400)

  const body = await c.req.json<Partial<{
    name:string; title_prefix:string|null; room:string|null;
    phone_ext:string|null; hours: Array<{day:string;from:string;to:string}>; active:boolean
  }>>()

  const sets: string[] = []; const vals: unknown[] = []
  if ('name' in body) { sets.push('name = ?'); vals.push(body.name) }
  if ('title_prefix' in body) { sets.push('title_prefix = ?'); vals.push(body.title_prefix ?? null) }
  if ('room' in body) { sets.push('room = ?'); vals.push(body.room ?? null) }
  if ('phone_ext' in body) { sets.push('phone_ext = ?'); vals.push(body.phone_ext ?? null) }
  if ('hours' in body) { sets.push('hours = ?'); vals.push(JSON.stringify(body.hours)) }
  if ('active' in body) { sets.push('active = ?'); vals.push(body.active ? 1 : 0) }
  if (!sets.length) return c.json({ error: 'no fields' }, 400)
  sets.push("updated_at = datetime('now')")
  vals.push(role)

  const row = await c.env.DB.prepare(
    `UPDATE specialists SET ${sets.join(', ')} WHERE role = ? RETURNING *`
  ).bind(...vals).first<SpecialistRow>()
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json({ specialist: specialistToJson(row) })
})

// POST /api/admin/menu [Admin] (multipart)
adminRouter.post('/menu', requireAdmin, async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const week_start = form.get('week_start') as string | null
  const notes = form.get('notes') as string | null

  if (!week_start) return c.json({ error: 'week_start required (YYYY-MM-DD)' }, 400)

  let r2_key: string | null = null
  if (file) {
    r2_key = `menu/${week_start}.pdf`
    await uploadToR2(c.env, r2_key, file, 'application/pdf')
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO menu_weeks (week_start, r2_key, notes)
     VALUES (?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET r2_key = excluded.r2_key, notes = excluded.notes
     RETURNING *`
  ).bind(week_start, r2_key, notes ?? null).first<MenuWeekRow>()

  return c.json({ menu: menuToJson(row!, c.env) }, 201)
})

// DELETE /api/admin/menu/:id [Admin]
adminRouter.delete('/menu/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT r2_key FROM menu_weeks WHERE id = ?').bind(id).first<{r2_key:string|null}>()
  if (!row) return c.json({ error: 'not found' }, 404)
  if (row.r2_key) await c.env.MEDIA.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM menu_weeks WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})
```

- [ ] **Przetestuj aktualizację specjalisty**

```bash
curl -X PUT http://localhost:8788/api/admin/specialists/psycholog \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <secret>" -H "X-Admin-Email: sp32.tech@gmail.com" \
  -d '{"hours":[{"day":"Poniedziałek","from":"9:00","to":"15:00"}]}'
# Oczekiwany: HTTP 200, zaktualizowane godziny

curl http://localhost:8788/api/public/specialists
# Oczekiwany: psycholog ma zaktualizowane godziny
```

- [ ] **Commit**

```bash
git add functions/_lib/routes/admin.ts
git commit -m "feat: admin API for documents, specialists, menu (admin-only)"
```

---

## Task 5: Admin API — RODO

**Files:**
- Create: `migrations/0002_rodo_audit_log.sql`
- Modify: `functions/_lib/routes/admin.ts`

Endpointy (wszystkie wymagają `admin`):
- `GET /api/admin/rodo/requests` — lista wniosków
- `POST /api/admin/rodo/requests` — nowy wniosek
- `PUT /api/admin/rodo/requests/:id` — aktualizuj status
- `GET /api/admin/rodo/audit` — albumy wymagające uwagi (graduation_year <= current_year)

### Zakres

- [ ] **Utwórz `migrations/0002_rodo_audit_log.sql`**

```sql
CREATE TABLE IF NOT EXISTS rodo_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at       TEXT NOT NULL DEFAULT (datetime('now')),
  albums_count INTEGER NOT NULL DEFAULT 0,
  payload      TEXT NOT NULL DEFAULT '[]'  -- JSON: [{album_id, title, graduation_year, type}]
);
```

- [ ] **Zaaplikuj migrację lokalnie**

```bash
npm run db:migrate:local
```

Oczekiwany output: `✅ Applied 1 migration(s)`

- [ ] **Dodaj endpointy RODO do `admin.ts`**

```typescript
import type { ConsentRequestRow } from '../types'
// Dodaj do types.ts: interface ConsentRequestRow { ... }

// GET /api/admin/rodo/requests [Admin]
adminRouter.get('/rodo/requests', requireAdmin, async (c) => {
  const status = c.req.query('status') // optional filter
  const query = status
    ? 'SELECT * FROM consent_requests WHERE status = ? ORDER BY requested_at DESC LIMIT 100'
    : 'SELECT * FROM consent_requests ORDER BY requested_at DESC LIMIT 100'
  const rows = status
    ? await c.env.DB.prepare(query).bind(status).all()
    : await c.env.DB.prepare(query).all()
  return c.json({ requests: rows.results ?? [] })
})

// POST /api/admin/rodo/requests [Admin]
adminRouter.post('/rodo/requests', requireAdmin, async (c) => {
  const body = await c.req.json<{
    student_name: string; class_label?: string;
    graduation_year?: number; request_type: 'withdrawal'|'deletion'; notes?: string
  }>()
  if (!body.student_name || !body.request_type) {
    return c.json({ error: 'student_name and request_type required' }, 400)
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO consent_requests (student_name, class_label, graduation_year, request_type, notes)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  ).bind(body.student_name, body.class_label ?? null, body.graduation_year ?? null,
    body.request_type, body.notes ?? null).first()
  return c.json({ request: row }, 201)
})

// PUT /api/admin/rodo/requests/:id [Admin]
adminRouter.put('/rodo/requests/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{status?: 'pending'|'in_progress'|'resolved'; notes?: string}>()
  const user = c.get('user')

  const sets: string[] = []; const vals: unknown[] = []
  if ('status' in body) {
    sets.push('status = ?'); vals.push(body.status)
    if (body.status === 'resolved') {
      sets.push("resolved_at = datetime('now')")
      sets.push('resolved_by = ?'); vals.push(user.email)
    }
  }
  if ('notes' in body) { sets.push('notes = ?'); vals.push(body.notes ?? null) }
  if (!sets.length) return c.json({ error: 'no fields' }, 400)
  vals.push(id)
  const row = await c.env.DB.prepare(`UPDATE consent_requests SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...vals).first()
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json({ request: row })
})

// GET /api/admin/rodo/audit [Admin] — albumy wymagające uwagi
adminRouter.get('/rodo/audit', requireAdmin, async (c) => {
  const currentYear = new Date().getFullYear()
  const rows = await c.env.DB.prepare(
    `SELECT id, title, slug, graduation_year,
       CASE WHEN graduation_year + 3 <= ? THEN 'autonomy' ELSE 'retention' END as audit_type
     FROM gallery_albums
     WHERE graduation_year <= ?
     ORDER BY graduation_year ASC`
  ).bind(currentYear, currentYear).all()
  return c.json({ albums: rows.results ?? [], current_year: currentYear })
})
```

- [ ] **Dodaj `ConsentRequestRow` do `functions/_lib/types.ts`**

```typescript
export interface ConsentRequestRow {
  id: number
  student_name: string
  class_label: string | null
  graduation_year: number | null
  request_type: 'withdrawal' | 'deletion'
  requested_at: string
  resolved_at: string | null
  resolved_by: string | null
  status: 'pending' | 'in_progress' | 'resolved'
  notes: string | null
}
```

- [ ] **Przetestuj**

```bash
curl http://localhost:8788/api/admin/rodo/audit \
  -H "X-Admin-Secret: <secret>" -H "X-Admin-Email: sp32.tech@gmail.com"
# Oczekiwany: {"albums":[],"current_year":2026} (brak albumów — OK)
```

- [ ] **Commit**

```bash
git add migrations/ functions/
git commit -m "feat: admin API for RODO requests and audit"
```

---

## Task 6: Admin UI — shared layout + dashboard

**Files:**
- Create: `admin/_shared.css`
- Create: `admin/_shared.js`
- Create: `admin/index.html`

Admin UI to proste strony HTML + Alpine.js. Nie używają Jinja2 / build.py — są serwowane bezpośrednio jako statyczne pliki przez CF Pages z katalogu `admin/`.

### Zakres

- [ ] **Utwórz `admin/_shared.css`**

Wspólny layout panelu: sidebar lewy (200px), content area, nagłówek. Kolorystyka: neutralna (dark sidebar `#1a1a2e`, białe tło contentu). Musi importować `/tokens.css` via `<link>` w każdym HTML.

```css
/* admin/_shared.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; background: #f5f5f5; color: #222; min-height: 100vh; display: flex }
a { text-decoration: none; color: inherit }

/* Sidebar */
#sidebar { width: 200px; min-height: 100vh; background: #1a1a2e; color: #ccc; display: flex; flex-direction: column; flex-shrink: 0; position: fixed; top: 0; left: 0; bottom: 0; z-index: 100 }
#sidebar .brand { padding: 1.25rem 1rem; border-bottom: 1px solid rgba(255,255,255,.08) }
#sidebar .brand span { font-weight: 700; font-size: .85rem; color: #fff }
#sidebar .brand small { display: block; font-size: .7rem; color: rgba(255,255,255,.4); margin-top: .1rem }
#sidebar nav { flex: 1; padding: .5rem 0 }
#sidebar nav a { display: flex; align-items: center; gap: .6rem; padding: .6rem 1rem; font-size: .8rem; color: rgba(255,255,255,.6); transition: color .15s, background .15s; border-radius: 0 }
#sidebar nav a:hover, #sidebar nav a.active { color: #fff; background: rgba(255,255,255,.08) }
#sidebar nav .nav-section { font-size: .65rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.3); padding: .75rem 1rem .25rem }
#sidebar nav a.admin-only { opacity: .7 }
#sidebar .sidebar-footer { padding: .75rem 1rem; border-top: 1px solid rgba(255,255,255,.08); font-size: .7rem; color: rgba(255,255,255,.4) }

/* Main */
#main { margin-left: 200px; flex: 1; min-height: 100vh; display: flex; flex-direction: column }
#topbar { background: #fff; border-bottom: 1px solid #e8e8e8; padding: .75rem 1.5rem; display: flex; align-items: center; justify-content: space-between }
#topbar h1 { font-size: 1rem; font-weight: 700; color: #222 }
#topbar .user-pill { font-size: .75rem; color: #666; background: #f0f0f0; padding: .25rem .75rem; border-radius: 999px }
#content { padding: 1.5rem; flex: 1 }

/* Cards */
.card { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem }
.card-title { font-size: .85rem; font-weight: 700; color: #444; margin-bottom: 1rem }

/* Stat grid */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 1.5rem }
.stat-card { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 1rem; text-align: center }
.stat-value { font-size: 1.75rem; font-weight: 800; color: #1a1a2e }
.stat-label { font-size: .75rem; color: #888; margin-top: .25rem }

/* Table */
.data-table { width: 100%; border-collapse: collapse; font-size: .8rem }
.data-table th { background: #f8f8f8; text-align: left; padding: .5rem .75rem; font-weight: 700; color: #555; border-bottom: 2px solid #e8e8e8 }
.data-table td { padding: .5rem .75rem; border-bottom: 1px solid #f0f0f0; vertical-align: middle }
.data-table tr:hover td { background: #fafafa }

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: .4rem; font-size: .8rem; font-weight: 700; padding: .4rem .9rem; border-radius: 6px; border: none; cursor: pointer; transition: opacity .15s }
.btn-primary { background: #1a1a2e; color: #fff }
.btn-primary:hover { opacity: .85 }
.btn-danger { background: #dc2626; color: #fff }
.btn-danger:hover { opacity: .85 }
.btn-outline { background: transparent; color: #444; border: 1px solid #d0d0d0 }
.btn-outline:hover { background: #f5f5f5 }
.btn-sm { font-size: .72rem; padding: .25rem .6rem }

/* Badge */
.badge { display: inline-block; font-size: .65rem; font-weight: 700; padding: .15rem .4rem; border-radius: 4px; text-transform: uppercase; letter-spacing: .04em }
.badge-green { background: #dcfce7; color: #166534 }
.badge-yellow { background: #fef9c3; color: #854d0e }
.badge-red { background: #fee2e2; color: #991b1b }
.badge-gray { background: #f0f0f0; color: #666 }

/* Form */
.form-group { margin-bottom: 1rem }
.form-label { display: block; font-size: .78rem; font-weight: 700; color: #444; margin-bottom: .35rem }
.form-input { width: 100%; padding: .45rem .75rem; border: 1px solid #d0d0d0; border-radius: 6px; font-size: .85rem; background: #fff; color: #222 }
.form-input:focus { outline: none; border-color: #1a1a2e; box-shadow: 0 0 0 2px rgba(26,26,46,.1) }
textarea.form-input { resize: vertical; min-height: 100px }
.form-hint { font-size: .72rem; color: #888; margin-top: .25rem }

/* Drawer overlay */
.drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 200; display: none }
.drawer-overlay.open { display: block }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(520px, 100vw); background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,.1); z-index: 201; display: flex; flex-direction: column; transform: translateX(100%); transition: transform .25s ease }
.drawer.open { transform: translateX(0) }
.drawer-header { padding: 1rem 1.25rem; border-bottom: 1px solid #e8e8e8; display: flex; align-items: center; justify-content: space-between }
.drawer-header h2 { font-size: .95rem; font-weight: 700 }
.drawer-body { flex: 1; overflow-y: auto; padding: 1.25rem }
.drawer-footer { padding: 1rem 1.25rem; border-top: 1px solid #e8e8e8; display: flex; gap: .75rem; justify-content: flex-end }

/* Alert */
.alert { padding: .75rem 1rem; border-radius: 6px; font-size: .82rem; margin-bottom: 1rem }
.alert-warn { background: #fef9c3; border: 1px solid #fde68a; color: #854d0e }
.alert-error { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b }

/* Skeleton */
.skel { background: #f0f0f0; border-radius: 4px; animation: pulse 1.5s ease-in-out infinite }
@keyframes pulse { 0%,100%{opacity:1}50%{opacity:.5} }

@media (max-width: 640px) {
  #sidebar { display: none }
  #main { margin-left: 0 }
}
```

- [ ] **Utwórz `admin/_shared.js`**

```javascript
// Shared admin JS helpers

const API = {
  async get(path) {
    const r = await fetch('/api/admin' + path, { headers: adminHeaders() })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  async post(path, body) {
    const r = await fetch('/api/admin' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
    return r.json()
  },
  async put(path, body) {
    const r = await fetch('/api/admin' + path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
    return r.json()
  },
  async delete(path) {
    const r = await fetch('/api/admin' + path, { method: 'DELETE', headers: adminHeaders() })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  async postForm(path, formData) {
    const r = await fetch('/api/admin' + path, { method: 'POST', headers: adminHeaders(), body: formData })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
    return r.json()
  }
}

// In production: no extra headers (CF Access JWT comes from browser via cookie)
// In local dev (served via wrangler): inject from localStorage
function adminHeaders() {
  const secret = localStorage.getItem('admin_dev_secret')
  const email = localStorage.getItem('admin_dev_email')
  if (secret && email) return { 'X-Admin-Secret': secret, 'X-Admin-Email': email }
  return {}
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/ą/g,'a').replace(/ć/g,'c').replace(/ę/g,'e').replace(/ł/g,'l')
    .replace(/ń/g,'n').replace(/ó/g,'o').replace(/ś/g,'s').replace(/ź|ż/g,'z')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
```

- [ ] **Utwórz `admin/index.html`** — dashboard

```html
<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel Admina — SP32 Sosnowiec</title>
<link rel="stylesheet" href="/_shared.css">
<script src="/_shared.js" defer></script>
<script src="/alpine.min.js" defer></script>
</head>
<body>
<!-- WAŻNE: w produkcji /_shared.css to /admin/_shared.css, ale CF Pages serwuje z roota katalogu -->
<!-- Użyj ścieżek relatywnych: href="../_shared.css" lub konfiguruj odpowiednio -->
```

> **Uwaga implementacyjna:** Wszystkie pliki `admin/*.html` linkują CSS/JS jako ścieżki **relatywne do roota**: `<link href="/_shared.css">` — CF Pages serwuje pliki z katalogu projektu, więc `/admin/_shared.css` jest dostępne jako `/_shared.css` przez linki lub jako `/admin/_shared.css`. Używaj `/admin/_shared.css` i `/admin/_shared.js` dla precyzji.

Pełna zawartość `admin/index.html`:

```html
<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel Admina — SP32</title>
<link rel="stylesheet" href="/admin/_shared.css">
</head>
<body x-data="dashApp()" x-init="init()">
<div id="sidebar">
  <div class="brand"><span>SP32 Panel</span><small x-text="user.role === 'admin' ? 'Administrator' : 'Redaktor'"></small></div>
  <nav>
    <a href="/admin/index.html" class="active">📊 Dashboard</a>
    <div class="nav-section">Treści</div>
    <a href="/admin/news/index.html">📰 Aktualności</a>
    <a href="/admin/gallery/index.html">🖼️ Galeria</a>
    <template x-if="user.role === 'admin'">
      <div>
        <div class="nav-section">Admin</div>
        <a href="/admin/documents/index.html" class="admin-only">📄 Dokumenty</a>
        <a href="/admin/specialists/index.html" class="admin-only">👥 Specjaliści</a>
        <a href="/admin/menu/index.html" class="admin-only">🍽️ Jadłospis</a>
        <a href="/admin/rodo/index.html" class="admin-only">🔐 RODO</a>
      </div>
    </template>
  </nav>
  <div class="sidebar-footer" x-text="user.email || 'Ładowanie...'"></div>
</div>
<div id="main">
  <div id="topbar"><h1>Dashboard</h1><span class="user-pill" x-text="user.email"></span></div>
  <div id="content">
    <template x-if="loading"><div class="skel" style="height:200px;border-radius:8px"></div></template>
    <template x-if="!loading">
      <div>
        <div class="stat-grid">
          <div class="stat-card"><div class="stat-value" x-text="stats.news"></div><div class="stat-label">Aktualności</div></div>
          <div class="stat-card"><div class="stat-value" x-text="stats.albums"></div><div class="stat-label">Albumy</div></div>
          <div class="stat-card"><div class="stat-value" x-text="stats.documents"></div><div class="stat-label">Dokumenty</div></div>
          <div class="stat-card"><div class="stat-value" x-text="stats.rodo_pending"></div><div class="stat-label">Wnioski RODO</div></div>
        </div>
        <template x-if="rodoAlerts.length > 0">
          <div class="alert alert-warn">
            ⚠️ <strong x-text="rodoAlerts.length"></strong> albumów wymaga przeglądu RODO →
            <a href="/admin/rodo/index.html" style="font-weight:700">Przejdź do RODO</a>
          </div>
        </template>
      </div>
    </template>
  </div>
</div>
<script src="/admin/_shared.js"></script>
<script src="/alpine.min.js" defer></script>
<script>
function dashApp() {
  return {
    user: { email: '', role: 'editor' },
    stats: { news: 0, albums: 0, documents: 0, rodo_pending: 0 },
    rodoAlerts: [],
    loading: true,
    async init() {
      try {
        const me = await API.get('/me')
        this.user = me
        const [news, albums, docs, rodo, audit] = await Promise.all([
          API.get('/me').then(() => fetch('/api/public/news?limit=1').then(r=>r.json())).catch(()=>({items:[]})),
          // Dla statystyk: proste endpointy zliczające
          fetch('/api/public/gallery').then(r=>r.json()).catch(()=>({albums:[]})),
          fetch('/api/public/documents/dokumenty').then(r=>r.json()).catch(()=>({documents:[]})),
          API.get('/rodo/requests?status=pending').catch(()=>({requests:[]})),
          API.get('/rodo/audit').catch(()=>({albums:[]})),
        ])
        this.stats.albums = albums.albums?.length ?? 0
        this.stats.documents = docs.documents?.length ?? 0
        this.stats.rodo_pending = rodo.requests?.length ?? 0
        this.rodoAlerts = audit.albums ?? []
      } catch(e) { console.error(e) }
      finally { this.loading = false }
    }
  }
}
</script>
</body>
</html>
```

- [ ] **Przetestuj lokalnie**

```bash
npm run dev
# Otwórz http://localhost:8788/admin/index.html
# W konsoli przeglądarki: localStorage.setItem('admin_dev_secret','<secret>'); localStorage.setItem('admin_dev_email','sp32.tech@gmail.com'); location.reload()
# Powinien pojawić się dashboard z sidebar i statystykami
```

- [ ] **Commit**

```bash
git add admin/
git commit -m "feat: admin UI shared layout, CSS, JS helpers, dashboard"
```

---

## Task 7: Admin UI — aktualności (lista + edytor)

**Files:**
- Create: `admin/news/index.html`

Funkcje:
- Lista aktualności z paginacją (pobiera z `/api/public/news?limit=50`)
- Przycisk "Nowa aktualność" → drawer z formularzem
- Klik w wiersz tabeli → drawer z formularzem edycji
- Przycisk usuń (z potwierdzeniem)
- Pola: `title`, `slug` (auto z tytułu), `excerpt`, `body_html` (textarea), `published_at`

### Zakres

- [ ] **Utwórz `admin/news/index.html`**

Pełna implementacja z Alpine.js. Struktura:
1. Sidebar (taki sam jak dashboard, link na "Aktualności" ma klasę `active`)
2. Topbar z tytułem "Aktualności" i przyciskiem "+ Nowa aktualność"
3. Tabela z kolumnami: Tytuł | Status | Data | Autor | Akcje
4. Drawer (prawy panel) z formularzem POST/PUT

Status: jeśli `published_at` i `published_at <= teraz` → badge-green "Opublikowany", jeśli `published_at` ale w przyszłości → badge-yellow "Zaplanowany", jeśli null → badge-gray "Szkic"

Drawer pola:
- `title` → input text (required)
- `slug` → input text (auto-generowany z tytułu, edytowalny)
- `excerpt` → textarea (opcjonalny)
- `body_html` → textarea large (opcjonalny, HTML)
- `published_at` → datetime-local input (opcjonalny, konwersja do ISO string)

Przy save: jeśli `editing.id` istnieje → `PUT /api/admin/news/:id`, inaczej → `POST /api/admin/news`.

```html
<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aktualności — Panel SP32</title>
<link rel="stylesheet" href="/admin/_shared.css">
</head>
<body x-data="newsAdmin()" x-init="init()">
<!-- SIDEBAR (skopiuj z index.html, zmień active na /news/) -->
<div id="sidebar">
  <div class="brand"><span>SP32 Panel</span><small x-text="role === 'admin' ? 'Administrator' : 'Redaktor'"></small></div>
  <nav>
    <a href="/admin/index.html">📊 Dashboard</a>
    <div class="nav-section">Treści</div>
    <a href="/admin/news/index.html" class="active">📰 Aktualności</a>
    <a href="/admin/gallery/index.html">🖼️ Galeria</a>
    <template x-if="role === 'admin'">
      <div>
        <div class="nav-section">Admin</div>
        <a href="/admin/documents/index.html" class="admin-only">📄 Dokumenty</a>
        <a href="/admin/specialists/index.html" class="admin-only">👥 Specjaliści</a>
        <a href="/admin/menu/index.html" class="admin-only">🍽️ Jadłospis</a>
        <a href="/admin/rodo/index.html" class="admin-only">🔐 RODO</a>
      </div>
    </template>
  </nav>
  <div class="sidebar-footer" x-text="userEmail"></div>
</div>

<div id="main">
  <div id="topbar">
    <h1>Aktualności</h1>
    <button class="btn btn-primary" @click="openDrawer(null)">+ Nowa aktualność</button>
  </div>
  <div id="content">
    <template x-if="loading">
      <div><div class="skel" style="height:300px;border-radius:8px"></div></div>
    </template>
    <template x-if="!loading">
      <div class="card" style="padding:0;overflow:hidden">
        <table class="data-table">
          <thead><tr><th>Tytuł</th><th>Status</th><th>Data publ.</th><th>Autor</th><th></th></tr></thead>
          <tbody>
            <template x-for="item in items" :key="item.id">
              <tr>
                <td style="font-weight:600" x-text="item.title"></td>
                <td>
                  <span class="badge" :class="statusBadge(item.published_at)" x-text="statusLabel(item.published_at)"></span>
                </td>
                <td x-text="fmtDate(item.published_at)"></td>
                <td style="color:#888;font-size:.75rem" x-text="item.author_email ?? '—'"></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-outline btn-sm" @click="openDrawer(item)">Edytuj</button>
                  <button class="btn btn-danger btn-sm" @click="remove(item)" style="margin-left:.4rem">Usuń</button>
                </td>
              </tr>
            </template>
            <template x-if="items.length === 0">
              <tr><td colspan="5" style="color:#999;text-align:center;padding:2rem">Brak aktualności</td></tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</div>

<!-- Drawer -->
<div class="drawer-overlay" :class="{open: drawerOpen}" @click="closeDrawer()"></div>
<div class="drawer" :class="{open: drawerOpen}">
  <div class="drawer-header">
    <h2 x-text="editing.id ? 'Edytuj aktualność' : 'Nowa aktualność'"></h2>
    <button class="btn btn-outline btn-sm" @click="closeDrawer()">✕</button>
  </div>
  <div class="drawer-body">
    <div class="form-group">
      <label class="form-label">Tytuł *</label>
      <input class="form-input" x-model="editing.title" @input="autoSlug()" placeholder="Tytuł aktualności">
    </div>
    <div class="form-group">
      <label class="form-label">Slug (URL)</label>
      <input class="form-input" x-model="editing.slug" placeholder="tytuł-aktualnosci">
      <p class="form-hint">Automatycznie generowany z tytułu</p>
    </div>
    <div class="form-group">
      <label class="form-label">Skrót (excerpt)</label>
      <textarea class="form-input" x-model="editing.excerpt" rows="3" placeholder="Krótki opis widoczny na liście"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Treść (HTML)</label>
      <textarea class="form-input" x-model="editing.body_html" rows="10" placeholder="<p>Treść artykułu...</p>"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Data publikacji</label>
      <input class="form-input" type="datetime-local" x-model="editing.published_at_local">
      <p class="form-hint">Puste = szkic (niewidoczny publicznie)</p>
    </div>
    <div x-show="saveError" class="alert alert-error" x-text="saveError"></div>
  </div>
  <div class="drawer-footer">
    <button class="btn btn-outline" @click="closeDrawer()">Anuluj</button>
    <button class="btn btn-primary" @click="save()" :disabled="saving" x-text="saving ? 'Zapisywanie...' : 'Zapisz'"></button>
  </div>
</div>

<script src="/admin/_shared.js"></script>
<script src="/alpine.min.js" defer></script>
<script>
function newsAdmin() {
  return {
    items: [], loading: true,
    drawerOpen: false, editing: {}, saving: false, saveError: '',
    userEmail: '', role: 'editor',
    async init() {
      try {
        const me = await API.get('/me')
        this.userEmail = me.email; this.role = me.role
      } catch {}
      await this.load()
    },
    async load() {
      this.loading = true
      try {
        const d = await fetch('/api/public/news?limit=50').then(r => r.json())
        this.items = d.items ?? []
      } catch {}
      finally { this.loading = false }
    },
    openDrawer(item) {
      if (item) {
        const local = item.published_at ? item.published_at.replace(' ', 'T').slice(0,16) : ''
        this.editing = { ...item, published_at_local: local }
      } else {
        this.editing = { title: '', slug: '', excerpt: '', body_html: '', published_at_local: '' }
      }
      this.saveError = ''; this.drawerOpen = true
    },
    closeDrawer() { this.drawerOpen = false },
    autoSlug() {
      if (!this.editing.id) this.editing.slug = slugify(this.editing.title)
    },
    async save() {
      if (!this.editing.title || !this.editing.slug) { this.saveError = 'Tytuł i slug są wymagane'; return }
      this.saving = true; this.saveError = ''
      try {
        const pub = this.editing.published_at_local ? new Date(this.editing.published_at_local).toISOString().replace('T',' ').slice(0,19) : null
        const payload = { title: this.editing.title, slug: this.editing.slug, excerpt: this.editing.excerpt || null, body_html: this.editing.body_html || null, published_at: pub }
        if (this.editing.id) await API.put('/news/' + this.editing.id, payload)
        else await API.post('/news', payload)
        this.closeDrawer(); await this.load()
      } catch(e) { this.saveError = e.message }
      finally { this.saving = false }
    },
    async remove(item) {
      if (!confirm(`Usunąć "${item.title}"?`)) return
      try { await API.delete('/news/' + item.id); await this.load() } catch(e) { alert(e.message) }
    },
    statusLabel(pub) {
      if (!pub) return 'Szkic'
      return new Date(pub) <= new Date() ? 'Opublikowany' : 'Zaplanowany'
    },
    statusBadge(pub) {
      if (!pub) return 'badge-gray'
      return new Date(pub) <= new Date() ? 'badge-green' : 'badge-yellow'
    },
    fmtDate
  }
}
</script>
</body>
</html>
```

- [ ] **Przetestuj**

```
http://localhost:8788/admin/news/index.html
```
Po ustawieniu localStorage dev credentials: lista powinna się załadować, drawer powinien otwierać się i zamykać, zapis powinien działać.

- [ ] **Commit**

```bash
git add admin/news/
git commit -m "feat: admin UI aktualnosci - list + editor drawer"
```

---

## Task 8: Admin UI — galeria

**Files:**
- Create: `admin/gallery/index.html`

Funkcje:
- Lista albumów z grid thumbnail
- Drawer do tworzenia albumu (title, slug, school_year, class_label, event_date)
- Widok albumu (klik na album) → grid zdjęć + upload nowych + usuń/anonimizuj
- Publish/unpublish toggle na albumie

### Zakres

- [ ] **Utwórz `admin/gallery/index.html`**

Dwa tryby Alpine.js:
1. `mode = 'list'` — lista albumów (grid kart z tytułem, datą, liczbą zdjęć, status published)
2. `mode = 'album'` — widok pojedynczego albumu:
   - Nagłówek z tytułem albumu + przycisk "← Wróć" + toggle Published
   - Upload box (drag & drop lub klik → `<input type="file" multiple accept="image/*">`)
   - Grid zdjęć (thumb 120px x 120px) z przyciskami: "Usuń" i "Anonimizuj" per zdjęcie

Upload flow:
1. User wybiera pliki
2. Dla każdego pliku: `API.postForm('/gallery/albums/' + albumId + '/photos', formData)`
3. Po zakończeniu: odśwież listę zdjęć

Zdjęcia nieposiadające `thumb_url` innego niż original wyświetlają się w pełnym rozmiarze z `max-height: 120px`.

- [ ] **Commit**

```bash
git add admin/gallery/
git commit -m "feat: admin UI galeria - album list + photo upload"
```

---

## Task 9: Admin UI — dokumenty, specjaliści, jadłospis (Admin-only)

**Files:**
- Create: `admin/documents/index.html`
- Create: `admin/specialists/index.html`
- Create: `admin/menu/index.html`

Każda strona wyświetla komunikat dla roli `editor` ("Brak dostępu — tylko Administrator").

### Dokumenty (`admin/documents/index.html`)

4 zakładki: Dokumenty szkolne | Druki | ZFŚS | RODO/IOD

Każda zakładka:
- Lista dokumentów (tabela: tytuł | typ | rozmiar | data | akcje)
- Upload button → `<input type="file" accept=".pdf,.docx">` → `POST /api/admin/documents`
- Edycja tytułu inline (klik → input)
- Usuń (z potwierdzeniem)

### Specjaliści (`admin/specialists/index.html`)

4 karty (psycholog, pedagog, doradca, pielegnarka). Każda karta:
- Wyświetla aktualne dane z `/api/public/specialists`
- Przycisk "Edytuj" → drawer z polami: name, title_prefix, room, phone_ext, hours (edytor godzin)
- Edytor godzin: tabela z wierszami `{day, from, to}` + przyciski dodaj/usuń wiersz

### Jadłospis (`admin/menu/index.html`)

- Lista tygodniowych jadłospisów (tabela: tydzień | link PDF | status | akcje)
- Formularz upload: `week_start` (date picker, wybiera poniedziałek) + `file` (PDF) + `notes`
- Usuń (z potwierdzeniem)

- [ ] **Commit**

```bash
git add admin/documents/ admin/specialists/ admin/menu/
git commit -m "feat: admin UI documents + specialists + menu (admin-only)"
```

---

## Task 10: Admin UI — RODO panel

**Files:**
- Create: `admin/rodo/index.html`

Dwie sekcje:

### Wnioski

Tabela wniosków z filtrem statusu (pending | in_progress | resolved).  
Kolumny: uczeń | klasa | typ wniosku | data | status | akcje  
Akcje: zmień status (dropdown), dodaj notatkę, oznacz jako resolved  
Formularz "Nowy wniosek" w drawer (student_name, class_label, request_type, notes)  

### Audit RODO

Lista albumów wymagających przeglądu z `/api/admin/rodo/audit`.  
Kolumny: album | klasa | rok ukończenia | typ audytu (retention/autonomy)  
Typ "retention" = `graduation_year <= current_year` (rocznik opuścił szkołę)  
Typ "autonomy" = `graduation_year + 3 <= current_year` (absolwenci pełnoletni)  
Każdy wiersz: link "Przejdź do albumu →" → `/admin/gallery/index.html#album-{id}`

- [ ] **Commit**

```bash
git add admin/rodo/
git commit -m "feat: admin UI RODO panel - requests + audit"
```

---

## Task 11: RODO Cron Worker (osobny Worker)

**Files:**
- Create: `workers/rodo-cron/index.ts`
- Create: `workers/rodo-cron/wrangler.toml`
- Create: `workers/rodo-cron/package.json`

Cron Worker działa niezależnie od Pages Functions. Deployuje się komendą `wrangler deploy` z katalogu `workers/rodo-cron/`. Używa tego samego D1 `sp32-db`.

**Cron schedule:** `0 8 1 9 *` (1 września, 8:00 UTC)

**Akcja:**
1. Pobierz bieżący rok
2. Zapytaj D1 o albumy z `graduation_year <= current_year`
3. Zapisz wynik do tabeli `rodo_audit_log` (z `payload` JSON)
4. Wyślij email przez Cloudflare Email Workers API (jeśli skonfigurowane) lub zaloguj wynik

### Zakres

- [ ] **Utwórz `workers/rodo-cron/wrangler.toml`**

```toml
name = "sp32-rodo-cron"
main = "index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "sp32-db"
database_id = "6d53c13a-f432-4deb-aa98-fe7186261c9c"

[triggers]
crons = ["0 8 1 9 *"]

[vars]
ADMIN_EMAIL = "sp32.tech@gmail.com"
```

- [ ] **Utwórz `workers/rodo-cron/package.json`**

```json
{
  "name": "sp32-rodo-cron",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Utwórz `workers/rodo-cron/index.ts`**

```typescript
export interface Env {
  DB: D1Database
  ADMIN_EMAIL: string
}

interface AuditAlbum {
  id: number
  title: string
  slug: string
  graduation_year: number
  audit_type: 'retention' | 'autonomy'
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAudit(env))
  }
}

async function runAudit(env: Env): Promise<void> {
  const currentYear = new Date().getFullYear()

  const rows = await env.DB.prepare(
    `SELECT id, title, slug, graduation_year,
       CASE WHEN graduation_year + 3 <= ? THEN 'autonomy' ELSE 'retention' END as audit_type
     FROM gallery_albums
     WHERE graduation_year <= ?
     ORDER BY graduation_year ASC`
  ).bind(currentYear, currentYear).all<AuditAlbum>()

  const albums = rows.results ?? []

  // Zapisz do audit log
  await env.DB.prepare(
    `INSERT INTO rodo_audit_log (albums_count, payload) VALUES (?, ?)`
  ).bind(albums.length, JSON.stringify(albums)).run()

  console.log(`[RODO Cron] ${new Date().toISOString()} — ${albums.length} albumów wymaga uwagi`)
  albums.forEach(a => {
    console.log(`  [${a.audit_type.toUpperCase()}] ${a.title} (graduation_year: ${a.graduation_year})`)
  })
}
```

- [ ] **Zaaplikuj migrację 0002 remote**

```bash
cd /Users/accept/Downloads/1-PROJEKTY/sp32sosnowiec
npm run db:migrate:remote
```

Oczekiwany output: `✅ Applied 1 migration(s)`

- [ ] **Przetestuj Cron Worker lokalnie**

```bash
cd workers/rodo-cron
npm install
npx wrangler dev
# W nowym terminalu: wywołaj cron manualnie
curl http://localhost:8787/__scheduled?cron=0+8+1+9+*
```

Oczekiwany output: log `[RODO Cron] ... — 0 albumów wymaga uwagi`

- [ ] **Commit**

```bash
cd ../..
git add workers/ migrations/
git commit -m "feat: RODO cron worker (separate Worker, stores audit to D1)"
```

- [ ] **Uwaga dot. deploymentu Workers:**

RODO Cron Worker deployuje się **oddzielnie** od Pages, komendą:
```bash
cd workers/rodo-cron
npx wrangler deploy
```
Nie jest częścią `git push` → Pages. Wymaga jednorazowego ręcznego deploy.

---

## Task 12: Deploy + końcowa walidacja

### Zakres

- [ ] **Push do main** — CF Pages zbuduje i deplouje admin UI + zaktualizowane API

```bash
git push origin main
```

- [ ] **Zaaplikuj migrację 0002 remote** (jeśli nie zrobiono w Task 11)

```bash
npm run db:migrate:remote
```

- [ ] **Skonfiguruj Cloudflare Access** (ręcznie w dashboardzie CF, poza zakresem kodu):

1. Wejdź w Zero Trust → Access → Applications → Add Application
2. Typ: "Self-hosted"
3. App domain: `sp32sosnowiec-website.pages.dev/admin/*` (lub domena docelowa)
4. Policy: Allow → Email → `sp32.tech@gmail.com` + ewentualni edytorzy
5. Identity provider: Google OAuth (już skonfigurowany lub dodaj nowy)

- [ ] **Przetestuj produkcję**

```bash
# Admin auth
curl -H "CF-Access-Jwt-Assertion: <real_jwt_from_browser>" \
     https://sp32sosnowiec-website.pages.dev/api/admin/me
# Oczekiwany: {"email":"...","role":"admin"}

# Stwórz aktualność
curl -X POST https://sp32sosnowiec-website.pages.dev/api/admin/news \
     -H "Content-Type: application/json" \
     -H "CF-Access-Jwt-Assertion: <jwt>" \
     -d '{"title":"Test prod","slug":"test-prod","published_at":"2026-08-31T12:00:00"}'

# Sprawdź publiczne API
curl https://sp32sosnowiec-website.pages.dev/api/public/news
```

- [ ] **Zaloguj się do panelu przez przeglądarkę**

```
https://sp32sosnowiec-website.pages.dev/admin/index.html
```
CF Access przekieruje do Google OAuth → po zalogowaniu → dashboard widoczny.

- [ ] **Commit końcowy**

```bash
git add .
git commit -m "chore: plan 2 complete - admin API + UI + RODO cron"
git push origin main
```

---

## Weryfikacja końcowa Planu 2

- [ ] `GET /api/admin/me` zwraca `{email, role}` dla zalogowanego użytkownika ✓
- [ ] `POST /api/admin/news` tworzy aktualność, widoczną w `/api/public/news` ✓
- [ ] `PUT /api/admin/specialists/psycholog` aktualizuje godziny ✓
- [ ] `POST /api/admin/documents` upload PDF do R2, widoczny w `/api/public/documents/druki` ✓
- [ ] `POST /api/admin/gallery/albums` tworzy album ✓
- [ ] `POST /api/admin/gallery/albums/:id/photos` upload zdjęcia do R2 ✓
- [ ] `GET /api/admin/rodo/audit` zwraca albumy wg reguł retencji ✓
- [ ] `admin/index.html` — dashboard ładuje się ze statystykami ✓
- [ ] `admin/news/index.html` — lista + drawer edycji działa ✓
- [ ] `admin/gallery/index.html` — albumy + upload zdjęć działa ✓
- [ ] `admin/specialists/index.html` — edytor godzin działa ✓
- [ ] `admin/rodo/index.html` — wnioski + audit panel działa ✓
- [ ] RODO Cron Worker deployuje się poprawnie, `/__scheduled` wywołuje audit ✓
- [ ] CF Access blokuje `/admin/*` dla niezalogowanych (weryfikacja ręczna) ✓

---

**Plan 3** (opcjonalnie, out-of-scope na razie): Formularz kontaktowy (Turnstile + Worker), Deklaracja dostępności, realne treści.
