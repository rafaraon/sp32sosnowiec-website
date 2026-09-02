import { Hono } from 'hono'
import type { Env, NewsRow, GalleryAlbumRow, GalleryPhotoRow, DocumentRow, SpecialistRow, MenuWeekRow } from '../types'
import { newsToJson, albumToJson, photoToJson, documentToJson, specialistToJson, menuToJson } from '../db'

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

publicRouter.get('/gallery', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM gallery_albums WHERE published = 1 ORDER BY event_date DESC, created_at DESC LIMIT 50`
  ).all<GalleryAlbumRow>()

  return c.json({ albums: (rows.results ?? []).map(r => albumToJson(r, c.env)) })
})

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

publicRouter.get('/documents/:category', async (c) => {
  const category = c.req.param('category')
  const allowed = ['dokumenty', 'zfss', 'druki', 'rodo']
  if (!allowed.includes(category)) return c.json({ error: 'invalid category' }, 400)

  const rows = await c.env.DB.prepare(
    `SELECT * FROM documents WHERE category = ? AND published = 1 ORDER BY sort_order ASC, uploaded_at DESC`
  ).bind(category).all<DocumentRow>()

  return c.json({ documents: (rows.results ?? []).map(r => documentToJson(r, c.env)) })
})

publicRouter.get('/specialists', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM specialists WHERE active = 1 ORDER BY id ASC`
  ).all<SpecialistRow>()

  return c.json({ specialists: (rows.results ?? []).map(specialistToJson) })
})

// POST /api/public/rodo/request — public RODO request submission
publicRouter.post('/rodo/request', async (c) => {
  const body = await c.req.json<{
    student_name?: string
    class_label?: string
    school_year?: string
    submitter_type?: string
    submitter_email?: string
    request_type?: string
    notes?: string
  }>().catch(() => ({}))

  if (!body.student_name?.trim()) return c.json({ error: 'Imię i nazwisko ucznia jest wymagane' }, 400)
  if (!['withdrawal', 'deletion'].includes(body.request_type ?? '')) return c.json({ error: 'Nieprawidłowy typ wniosku' }, 400)

  // Find matching albums by class + school_year
  type AlbumMatch = { id: number; title: string; slug: string }
  let matched: AlbumMatch[] = []
  if (body.class_label) {
    const q = body.school_year
      ? `SELECT id, title, slug FROM gallery_albums WHERE class_label = ? AND school_year = ? ORDER BY event_date DESC LIMIT 30`
      : `SELECT id, title, slug FROM gallery_albums WHERE class_label = ? ORDER BY event_date DESC LIMIT 30`
    const rows = body.school_year
      ? await c.env.DB.prepare(q).bind(body.class_label.trim(), body.school_year.trim()).all<AlbumMatch>()
      : await c.env.DB.prepare(q).bind(body.class_label.trim()).all<AlbumMatch>()
    matched = rows.results ?? []
  }

  // Graduation year from school_year string "2023/2024" → 2024
  let graduation_year: number | null = null
  if (body.school_year) {
    const parts = body.school_year.split('/')
    if (parts.length === 2) graduation_year = parseInt(parts[1]) || null
  }

  // Sequential reference number RODO-YYYY-NNN
  const year = new Date().getFullYear()
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM consent_requests WHERE requested_at >= ?`
  ).bind(`${year}-01-01`).first<{ cnt: number }>()
  const seq = String((countRow?.cnt ?? 0) + 1).padStart(3, '0')
  const ref = `RODO-${year}-${seq}`

  await c.env.DB.prepare(
    `INSERT INTO consent_requests
       (student_name, class_label, graduation_year, request_type,
        submitter_type, submitter_email, reference_number, matched_albums, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.student_name.trim(),
    body.class_label?.trim() || null,
    graduation_year,
    body.request_type,
    ['parent', 'student', 'adult'].includes(body.submitter_type ?? '') ? body.submitter_type : 'parent',
    body.submitter_email?.trim() || null,
    ref,
    JSON.stringify(matched),
    body.notes?.trim() || null
  ).run()

  return c.json({ ok: true, reference_number: ref, matched_albums_count: matched.length }, 201)
})

publicRouter.get('/menu/current', async (c) => {
  const today = new Date().toISOString().split('T')[0]
  const d = new Date(today)
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - day)
  const monday = d.toISOString().split('T')[0]

  const row = await c.env.DB.prepare(
    `SELECT * FROM menu_weeks WHERE week_start >= ? AND published = 1 ORDER BY week_start ASC LIMIT 1`
  ).bind(monday).first<MenuWeekRow>()

  return c.json({ menu: row ? menuToJson(row, c.env) : null })
})
