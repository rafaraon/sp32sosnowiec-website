import { Hono } from 'hono'
import type { Env, AdminUser, AdminUserRow, NewsRow, GalleryAlbumRow, GalleryPhotoRow, DocumentRow, MenuWeekRow, SpecialistRow, ConsentRequestRow } from '../types'
import { calcGraduationYear } from '../types'
import { adminAuth, requireAdmin } from '../auth'
import { newsToJson, albumToJson, photoToJson, documentToJson, menuToJson, specialistToJson, publicUrl } from '../db'
import { r2Key, uploadToR2 } from '../r2'
import { notifyParentResolved } from '../email'

type Variables = { user: AdminUser }

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

adminRouter.use('*', adminAuth)

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_IMAGE_BYTES = 25 * 1024 * 1024 // 25 MB

function validateImageUpload(file: File): { error: string; status: 400 | 413 | 415 } | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return { error: 'Dozwolone formaty: JPG, PNG, WebP, GIF', status: 415 }
  if (file.size > MAX_IMAGE_BYTES) return { error: 'Plik zbyt duży (maks. 25 MB)', status: 413 }
  return null
}

adminRouter.get('/me', (c) => {
  const user = c.get('user')
  return c.json({ email: user.email, role: user.role })
})

// GET /api/admin/news — list all articles (including drafts and scheduled)
adminRouter.get('/news', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM news ORDER BY created_at DESC LIMIT 200'
  ).all<NewsRow>()
  return c.json({ items: (rows.results ?? []).map(r => newsToJson(r, c.env)) })
})

// POST /api/admin/news — create article
adminRouter.post('/news', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{
    title?: string
    slug?: string
    excerpt?: string
    body_html?: string
    cover_r2_key?: string
    published_at?: string
    category?: string
  }>()

  if (!body.title || !body.slug) {
    return c.json({ error: 'title and slug are required' }, 400)
  }

  const VALID_CATEGORIES = ['komunikat', 'ogloszenie', 'wydarzenie', 'sukces', 'zfss']
  const category = body.category && VALID_CATEGORIES.includes(body.category) ? body.category : null

  const row = await c.env.DB.prepare(
    `INSERT INTO news (title, slug, excerpt, body_html, cover_r2_key, published_at, author_email, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      body.title,
      body.slug,
      body.excerpt ?? null,
      body.body_html ?? null,
      body.cover_r2_key ?? null,
      body.published_at ?? null,
      user.email,
      category
    )
    .first<NewsRow>()

  if (!row) {
    return c.json({ error: 'Insert failed' }, 500)
  }

  return c.json({ item: newsToJson(row, c.env) }, 201)
})

// PUT /api/admin/news/:id — update article (partial)
adminRouter.put('/news/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare('SELECT id FROM news WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()

  if (!existing) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json<Partial<{
    title: string
    slug: string
    excerpt: string
    body_html: string
    cover_r2_key: string
    published_at: string
    category: string
  }>>()

  const allowedKeys = ['title', 'slug', 'excerpt', 'body_html', 'cover_r2_key', 'published_at', 'category'] as const
  type AllowedKey = typeof allowedKeys[number]

  const VALID_CATEGORIES = ['komunikat', 'ogloszenie', 'wydarzenie', 'sukces', 'zfss']
  if ('category' in body) {
    (body as Record<string, unknown>)['category'] =
      body.category && VALID_CATEGORIES.includes(body.category) ? body.category : null
  }

  const sets: string[] = []
  const vals: unknown[] = []

  for (const key of allowedKeys) {
    if (key in body) {
      sets.push(`${key} = ?`)
      vals.push((body as Record<AllowedKey, unknown>)[key] ?? null)
    }
  }

  sets.push(`updated_at = datetime('now')`)
  vals.push(id)

  const row = await c.env.DB.prepare(
    `UPDATE news SET ${sets.join(', ')} WHERE id = ? RETURNING *`
  )
    .bind(...vals)
    .first<NewsRow>()

  if (!row) {
    return c.json({ error: 'Update failed' }, 500)
  }

  return c.json({ item: newsToJson(row, c.env) })
})

// POST /api/admin/news/:id/cover — upload cover image for article
adminRouter.post('/news/:id/cover', async (c) => {
  const id = Number(c.req.param('id'))

  const article = await c.env.DB.prepare('SELECT id, slug, cover_r2_key FROM news WHERE id = ?')
    .bind(id)
    .first<{ id: number; slug: string; cover_r2_key: string | null }>()

  if (!article) return c.json({ error: 'Not found' }, 404)

  const formData = await c.req.formData()
  const file = formData.get('file')
  if (!file || !(file instanceof File)) return c.json({ error: 'file is required' }, 400)
  const imgErr = validateImageUpload(file)
  if (imgErr) return c.json({ error: imgErr.error }, imgErr.status)

  if (article.cover_r2_key) {
    await c.env.MEDIA.delete(article.cover_r2_key).catch(() => {})
  }

  const key = r2Key(`news/${article.slug}/cover`, file.name)
  await uploadToR2(c.env, key, file)

  await c.env.DB.prepare('UPDATE news SET cover_r2_key = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(key, id)
    .run()

  return c.json({ cover_url: publicUrl(c.env, key) }, 200)
})

// DELETE /api/admin/news/:id — delete article (and R2 cover if present)
adminRouter.delete('/news/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare('SELECT id, cover_r2_key FROM news WHERE id = ?')
    .bind(id)
    .first<{ id: number; cover_r2_key: string | null }>()

  if (!existing) {
    return c.json({ error: 'Not found' }, 404)
  }

  if (existing.cover_r2_key) {
    await c.env.MEDIA.delete(existing.cover_r2_key).catch(() => {})
  }

  await c.env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run()

  return c.json({ ok: true })
})

// ── Gallery Albums ────────────────────────────────────────────────────────────

// GET /api/admin/gallery/albums — list all albums (including unpublished)
adminRouter.get('/gallery/albums', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, title, slug, school_year, class_label, graduation_year, event_date,
            cover_r2_key, published, created_at,
            (SELECT COUNT(*) FROM gallery_photos WHERE album_id = gallery_albums.id) as photo_count
     FROM gallery_albums ORDER BY created_at DESC`
  ).all<GalleryAlbumRow & { photo_count: number }>()
  const albums = (rows.results ?? []).map((a) => ({
    ...a,
    cover_url: a.cover_r2_key ? publicUrl(c.env, a.cover_r2_key) : null
  }))
  return c.json({ albums })
})

// POST /api/admin/gallery/albums — create album
adminRouter.post('/gallery/albums', async (c) => {
  const body = await c.req.json<{
    title?: string
    slug?: string
    school_year?: string
    class_label?: string
    event_date?: string
  }>()

  if (!body.title || !body.slug || !body.school_year) {
    return c.json({ error: 'title, slug, and school_year are required' }, 400)
  }

  const graduation_year = calcGraduationYear(body.school_year, body.class_label ?? null)

  const row = await c.env.DB.prepare(
    `INSERT INTO gallery_albums (title, slug, school_year, class_label, graduation_year, event_date)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      body.title,
      body.slug,
      body.school_year,
      body.class_label ?? null,
      graduation_year,
      body.event_date ?? null
    )
    .first<GalleryAlbumRow>()

  if (!row) {
    return c.json({ error: 'Insert failed' }, 500)
  }

  return c.json({ album: albumToJson(row, c.env) }, 201)
})

// PUT /api/admin/gallery/albums/:id — update album (partial)
adminRouter.put('/gallery/albums/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare('SELECT id FROM gallery_albums WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()

  if (!existing) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json<Partial<{
    title: string
    school_year: string
    class_label: string
    event_date: string
    published: boolean | number
    cover_r2_key: string
  }>>()

  const allowedKeys = ['title', 'school_year', 'class_label', 'event_date', 'published', 'cover_r2_key'] as const
  type AllowedKey = typeof allowedKeys[number]

  const sets: string[] = []
  const vals: unknown[] = []

  for (const key of allowedKeys) {
    if (key in body) {
      sets.push(`${key} = ?`)
      let val = (body as Record<AllowedKey, unknown>)[key] ?? null
      if (key === 'published') {
        val = val ? 1 : 0
      }
      vals.push(val)
    }
  }

  if ('school_year' in body && body.school_year) {
    const classLabel = 'class_label' in body
      ? (body.class_label ?? null)
      : (await c.env.DB.prepare('SELECT class_label FROM gallery_albums WHERE id = ?').bind(id).first<{ class_label: string | null }>())?.class_label ?? null
    const grad = calcGraduationYear(body.school_year, classLabel)
    sets.push('graduation_year = ?'); vals.push(grad)
  }

  if (sets.length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  vals.push(id)

  const row = await c.env.DB.prepare(
    `UPDATE gallery_albums SET ${sets.join(', ')} WHERE id = ? RETURNING *`
  )
    .bind(...vals)
    .first<GalleryAlbumRow>()

  if (!row) {
    return c.json({ error: 'Update failed' }, 500)
  }

  return c.json({ album: albumToJson(row, c.env) })
})

// DELETE /api/admin/gallery/albums/:id — delete album and all its R2 files
adminRouter.delete('/gallery/albums/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare('SELECT id FROM gallery_albums WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()

  if (!existing) {
    return c.json({ error: 'Not found' }, 404)
  }

  // Collect all photo R2 keys before deleting
  const photosResult = await c.env.DB.prepare(
    'SELECT r2_key, r2_key_thumb FROM gallery_photos WHERE album_id = ?'
  )
    .bind(id)
    .all<{ r2_key: string; r2_key_thumb: string | null }>()

  for (const photo of photosResult.results) {
    await c.env.MEDIA.delete(photo.r2_key).catch(() => {})
    if (photo.r2_key_thumb) {
      await c.env.MEDIA.delete(photo.r2_key_thumb).catch(() => {})
    }
  }

  // D1 ON DELETE CASCADE removes photos; delete album
  await c.env.DB.prepare('DELETE FROM gallery_albums WHERE id = ?').bind(id).run()

  return c.json({ ok: true })
})

// GET /api/admin/gallery/albums/:id/photos — list photos for any album (published or not)
adminRouter.get('/gallery/albums/:id/photos', async (c) => {
  const albumId = Number(c.req.param('id'))
  const photos = await c.env.DB.prepare(
    'SELECT * FROM gallery_photos WHERE album_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(albumId).all<GalleryPhotoRow>()
  return c.json({ photos: (photos.results ?? []).map(r => photoToJson(r, c.env)) })
})

// POST /api/admin/gallery/albums/:id/cover — upload cover image
adminRouter.post('/gallery/albums/:id/cover', async (c) => {
  const albumId = Number(c.req.param('id'))

  const album = await c.env.DB.prepare('SELECT id, slug, cover_r2_key FROM gallery_albums WHERE id = ?')
    .bind(albumId)
    .first<{ id: number; slug: string; cover_r2_key: string | null }>()

  if (!album) return c.json({ error: 'Not found' }, 404)

  const formData = await c.req.formData()
  const file = formData.get('file')
  if (!file || !(file instanceof File)) return c.json({ error: 'file is required' }, 400)
  const imgErr2 = validateImageUpload(file)
  if (imgErr2) return c.json({ error: imgErr2.error }, imgErr2.status)

  if (album.cover_r2_key) {
    await c.env.MEDIA.delete(album.cover_r2_key).catch(() => {})
  }

  const key = r2Key(`gallery/${album.slug}/cover`, file.name)
  await uploadToR2(c.env, key, file)

  await c.env.DB.prepare('UPDATE gallery_albums SET cover_r2_key = ? WHERE id = ?')
    .bind(key, albumId)
    .run()

  return c.json({ cover_url: publicUrl(c.env, key) }, 200)
})

// ── Gallery Photos ────────────────────────────────────────────────────────────

// POST /api/admin/gallery/albums/:id/photos — upload photo to album
adminRouter.post('/gallery/albums/:id/photos', async (c) => {
  const albumId = Number(c.req.param('id'))

  const album = await c.env.DB.prepare(
    'SELECT id, slug, graduation_year FROM gallery_albums WHERE id = ?'
  )
    .bind(albumId)
    .first<{ id: number; slug: string; graduation_year: number }>()

  if (!album) {
    return c.json({ error: 'Not found' }, 404)
  }

  const formData = await c.req.formData()
  const file = formData.get('file')
  const consent_ref = formData.get('consent_ref')

  if (!file || !(file instanceof File)) {
    return c.json({ error: 'file is required' }, 400)
  }
  const imgErr3 = validateImageUpload(file)
  if (imgErr3) return c.json({ error: imgErr3.error }, imgErr3.status)

  const key = r2Key('gallery/' + album.slug, file.name)
  await uploadToR2(c.env, key, file)

  const maxOrderRow = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM gallery_photos WHERE album_id = ?'
  )
    .bind(albumId)
    .first<{ max_order: number }>()

  const sort_order = (maxOrderRow?.max_order ?? 0) + 1

  const row = await c.env.DB.prepare(
    `INSERT INTO gallery_photos (album_id, r2_key, consent_ref, graduation_year, sort_order)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      albumId,
      key,
      typeof consent_ref === 'string' ? consent_ref : null,
      album.graduation_year,
      sort_order
    )
    .first<GalleryPhotoRow>()

  if (!row) {
    return c.json({ error: 'Insert failed' }, 500)
  }

  return c.json({ photo: photoToJson(row, c.env) }, 201)
})

// DELETE /api/admin/gallery/photos/:id — delete photo and its R2 files
adminRouter.delete('/gallery/photos/:id', async (c) => {
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare(
    'SELECT id, r2_key, r2_key_thumb FROM gallery_photos WHERE id = ?'
  )
    .bind(id)
    .first<{ id: number; r2_key: string; r2_key_thumb: string | null }>()

  if (!existing) {
    return c.json({ error: 'Not found' }, 404)
  }

  await c.env.MEDIA.delete(existing.r2_key)
  if (existing.r2_key_thumb) {
    await c.env.MEDIA.delete(existing.r2_key_thumb)
  }

  await c.env.DB.prepare('DELETE FROM gallery_photos WHERE id = ?').bind(id).run()

  return c.json({ ok: true })
})

// PUT /api/admin/gallery/photos/:id/anonymize — anonymize a photo
adminRouter.put('/gallery/photos/:id/anonymize', async (c) => {
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare('SELECT id FROM gallery_photos WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()

  if (!existing) {
    return c.json({ error: 'Not found' }, 404)
  }

  await c.env.DB.prepare(
    `UPDATE gallery_photos SET anonymized = 1, anonymized_at = datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run()

  return c.json({ ok: true })
})

// ── Documents ────────────────────────────────────────────────────────────────

// GET /api/admin/documents — list all documents including unpublished (admin only)
adminRouter.get('/documents', requireAdmin, async (c) => {
  const category = c.req.query('category')
  const allowed = ['dokumenty', 'zfss', 'druki', 'rodo']
  let rows
  if (category && allowed.includes(category)) {
    rows = await c.env.DB.prepare(
      'SELECT * FROM documents WHERE category = ? ORDER BY sort_order ASC, uploaded_at DESC'
    ).bind(category).all<DocumentRow>()
  } else {
    rows = await c.env.DB.prepare(
      'SELECT * FROM documents ORDER BY category ASC, sort_order ASC, uploaded_at DESC'
    ).all<DocumentRow>()
  }
  return c.json({ documents: (rows.results ?? []).map(r => documentToJson(r, c.env)) })
})

// POST /api/admin/documents — upload document
adminRouter.post('/documents', requireAdmin, async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const title = form.get('title') as string | null
  const category = form.get('category') as string | null
  const locationKey = form.get('location_key') as string | null

  if (!file || !title || !category) return c.json({ error: 'file, title, category required' }, 400)
  const allowed = ['dokumenty', 'zfss', 'druki', 'rodo']
  if (!allowed.includes(category)) return c.json({ error: 'invalid category' }, 400)

  const VALID_LOCATIONS = ['swietlica', 'pedagog', 'wycieczki', 'sekretariat']
  const resolvedLocation = category === 'druki' && locationKey && VALID_LOCATIONS.includes(locationKey)
    ? locationKey : null

  const key = r2Key(`documents/${category}`, file.name)
  await uploadToR2(c.env, key, file)

  const user = c.get('user')
  const row = await c.env.DB.prepare(
    `INSERT INTO documents (category, title, r2_key, file_type, file_size, uploaded_by, location_key)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(category, title, key,
    file.name.split('.').pop()?.toLowerCase() ?? null,
    file.size, user.email, resolvedLocation
  ).first<DocumentRow>()

  if (!row) return c.json({ error: 'Insert failed' }, 500)
  return c.json({ document: documentToJson(row, c.env) }, 201)
})

// PUT /api/admin/documents/:id — update document metadata
adminRouter.put('/documents/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const existing = await c.env.DB.prepare('SELECT id FROM documents WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<Partial<{ title: string; sort_order: number; published: boolean; location_key: string | null }>>()
  const sets: string[] = []; const vals: unknown[] = []
  if ('title' in body) { sets.push('title = ?'); vals.push(body.title) }
  if ('sort_order' in body) { sets.push('sort_order = ?'); vals.push(body.sort_order) }
  if ('published' in body) { sets.push('published = ?'); vals.push(body.published ? 1 : 0) }
  if ('location_key' in body) {
    const VALID_LOCATIONS = ['swietlica', 'pedagog', 'wycieczki', 'sekretariat']
    const loc = body.location_key
    sets.push('location_key = ?')
    vals.push(loc && VALID_LOCATIONS.includes(loc) ? loc : null)
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400)
  vals.push(id)

  const row = await c.env.DB.prepare(
    `UPDATE documents SET ${sets.join(', ')} WHERE id = ? RETURNING *`
  ).bind(...vals).first<DocumentRow>()
  if (!row) return c.json({ error: 'Update failed' }, 500)
  return c.json({ document: documentToJson(row, c.env) })
})

// DELETE /api/admin/documents/:id — delete document and its R2 file
adminRouter.delete('/documents/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT r2_key FROM documents WHERE id = ?')
    .bind(id).first<{ r2_key: string }>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  await c.env.MEDIA.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ── Specialists ───────────────────────────────────────────────────────────────

// PUT /api/admin/specialists/:role — update specialist by role
adminRouter.put('/specialists/:role', requireAdmin, async (c) => {
  const role = c.req.param('role') ?? ''
  const validRoles = ['psycholog', 'pedagog', 'doradca', 'pielegnarka']
  if (!validRoles.includes(role)) return c.json({ error: 'Invalid role' }, 400)

  const body = await c.req.json<Partial<{
    name: string; title_prefix: string | null; room: string | null;
    phone_ext: string | null; hours: Array<{ day: string; from: string; to: string }>; active: boolean
  }>>()

  const sets: string[] = []; const vals: unknown[] = []
  if ('name' in body) { sets.push('name = ?'); vals.push(body.name) }
  if ('title_prefix' in body) { sets.push('title_prefix = ?'); vals.push(body.title_prefix ?? null) }
  if ('room' in body) { sets.push('room = ?'); vals.push(body.room ?? null) }
  if ('phone_ext' in body) { sets.push('phone_ext = ?'); vals.push(body.phone_ext ?? null) }
  if ('hours' in body) { sets.push('hours = ?'); vals.push(JSON.stringify(body.hours)) }
  if ('active' in body) { sets.push('active = ?'); vals.push(body.active ? 1 : 0) }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400)
  sets.push("updated_at = datetime('now')")
  vals.push(role)

  const row = await c.env.DB.prepare(
    `UPDATE specialists SET ${sets.join(', ')} WHERE role = ? RETURNING *`
  ).bind(...vals).first<SpecialistRow>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ specialist: specialistToJson(row) })
})

// ── Menu ──────────────────────────────────────────────────────────────────────

// GET /api/admin/menu — list all menu weeks
adminRouter.get('/menu', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM menu_weeks ORDER BY week_start DESC LIMIT 52'
  ).all<MenuWeekRow>()
  return c.json({ weeks: (rows.results ?? []).map(r => menuToJson(r, c.env)) })
})

// POST /api/admin/menu — upsert menu week (multipart)
adminRouter.post('/menu', requireAdmin, async (c) => {
  const form = await c.req.formData()
  const file = form.get('file') as File | null
  const week_start = form.get('week_start') as string | null
  const notes = form.get('notes') as string | null

  if (!week_start) return c.json({ error: 'week_start required (YYYY-MM-DD)' }, 400)

  let menuKey: string | null = null
  if (file) {
    menuKey = `menu/${week_start}.pdf`
    await uploadToR2(c.env, menuKey, file, 'application/pdf')
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO menu_weeks (week_start, r2_key, notes)
     VALUES (?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET
       r2_key = CASE WHEN excluded.r2_key IS NOT NULL THEN excluded.r2_key ELSE r2_key END,
       notes = excluded.notes
     RETURNING *`
  ).bind(week_start, menuKey, notes ?? null).first<MenuWeekRow>()
  if (!row) return c.json({ error: 'Insert failed' }, 500)
  return c.json({ menu: menuToJson(row, c.env) }, 201)
})

// DELETE /api/admin/menu/:id — delete menu week and its R2 file
adminRouter.delete('/menu/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT r2_key FROM menu_weeks WHERE id = ?')
    .bind(id).first<{ r2_key: string | null }>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  if (row.r2_key) await c.env.MEDIA.delete(row.r2_key)
  await c.env.DB.prepare('DELETE FROM menu_weeks WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// GET /api/admin/rodo/requests — list consent requests (optional ?status= filter)
adminRouter.get('/rodo/requests', requireAdmin, async (c) => {
  const status = c.req.query('status')
  const query = status
    ? 'SELECT * FROM consent_requests WHERE status = ? ORDER BY requested_at DESC LIMIT 100'
    : 'SELECT * FROM consent_requests ORDER BY requested_at DESC LIMIT 100'
  const rows = status
    ? await c.env.DB.prepare(query).bind(status).all()
    : await c.env.DB.prepare(query).all()
  return c.json({ requests: rows.results ?? [] })
})

// POST /api/admin/rodo/requests — create consent request
adminRouter.post('/rodo/requests', requireAdmin, async (c) => {
  const body = await c.req.json<{
    student_name?: string
    class_label?: string
    graduation_year?: number
    request_type?: 'withdrawal' | 'deletion'
    notes?: string
  }>()
  if (!body.student_name || !body.request_type) {
    return c.json({ error: 'student_name and request_type required' }, 400)
  }
  const year = new Date().getFullYear()
  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM consent_requests WHERE requested_at >= ?'
  ).bind(`${year}-01-01`).first<{ cnt: number }>()
  const seq = String((countRow?.cnt ?? 0) + 1).padStart(3, '0')
  const ref = `RODO-${year}-${seq}`
  const row = await c.env.DB.prepare(
    `INSERT INTO consent_requests (student_name, class_label, graduation_year, request_type, notes, reference_number)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(
    body.student_name,
    body.class_label ?? null,
    body.graduation_year ?? null,
    body.request_type,
    body.notes ?? null,
    ref
  ).first<ConsentRequestRow>()
  return c.json({ request: row }, 201)
})

// PUT /api/admin/rodo/requests/:id — update status/notes/director_approved
adminRouter.put('/rodo/requests/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{
    status?: 'pending' | 'in_progress' | 'resolved'
    notes?: string
    director_approved?: boolean
  }>()
  const user = c.get('user')

  const VALID_STATUSES = ['pending', 'in_progress', 'resolved']
  if ('status' in body && body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return c.json({ error: 'Nieprawidłowy status. Dozwolone: pending, in_progress, resolved' }, 400)
  }

  const sets: string[] = []; const vals: unknown[] = []
  if ('status' in body) {
    sets.push('status = ?'); vals.push(body.status)
    if (body.status === 'resolved') {
      sets.push("resolved_at = datetime('now')")
      sets.push('resolved_by = ?'); vals.push(user.email)
    }
  }
  if ('notes' in body) { sets.push('notes = ?'); vals.push(body.notes ?? null) }
  if (body.director_approved) {
    sets.push("director_approved_at = datetime('now')")
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400)
  vals.push(id)

  const row = await c.env.DB.prepare(
    `UPDATE consent_requests SET ${sets.join(', ')} WHERE id = ? RETURNING *`
  ).bind(...vals).first<ConsentRequestRow>()
  if (!row) return c.json({ error: 'Not found' }, 404)

  if (body.status === 'resolved' && row.submitter_email && row.reference_number) {
    c.executionCtx.waitUntil(
      notifyParentResolved(c.env, row.submitter_email, {
        reference: row.reference_number,
        studentName: row.student_name,
        requestType: row.request_type,
        resolvedBy: user.email,
      }).catch(() => {})
    )
  }

  return c.json({ request: row })
})

// GET /api/admin/rodo/audit — gallery albums requiring RODO review
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

// ── USER MANAGEMENT (admin only) ──────────────────────────────────────────────

// GET /api/admin/users — list all admin users
adminRouter.get('/users', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, email, name, role, active, created_at, created_by FROM admin_users ORDER BY created_at ASC'
  ).all<AdminUserRow>()
  return c.json({ users: rows.results ?? [] })
})

// POST /api/admin/users — add a new admin user
adminRouter.post('/users', requireAdmin, async (c) => {
  const me = c.get('user')
  const body = await c.req.json<{ email?: string; name?: string; role?: string }>()

  const email = (body.email ?? '').trim().toLowerCase()
  const name  = (body.name  ?? '').trim()
  const role  = body.role === 'admin' ? 'admin' : 'editor'

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Podaj prawidłowy adres e-mail' }, 400)
  }
  if (!name) {
    return c.json({ error: 'Imię i nazwisko jest wymagane' }, 400)
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM admin_users WHERE email = ? COLLATE NOCASE'
  ).bind(email).first<{ id: number }>()

  if (existing) {
    return c.json({ error: 'Ten adres e-mail jest już zarejestrowany' }, 409)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO admin_users (email, name, role, active, created_by)
     VALUES (?, ?, ?, 1, ?) RETURNING *`
  ).bind(email, name, role, me.email).first<AdminUserRow>()

  if (!row) return c.json({ error: 'Insert failed' }, 500)
  return c.json({ user: row }, 201)
})

// PATCH /api/admin/users/:id — update name, role, active
adminRouter.patch('/users/:id', requireAdmin, async (c) => {
  const me = c.get('user')
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ name?: string; role?: string; active?: boolean }>()

  const existing = await c.env.DB.prepare(
    'SELECT id, email FROM admin_users WHERE id = ?'
  ).bind(id).first<{ id: number; email: string }>()

  if (!existing) return c.json({ error: 'Not found' }, 404)
  // Prevent self-demotion or deactivation
  if (existing.email.toLowerCase() === me.email.toLowerCase()) {
    return c.json({ error: 'Nie możesz edytować własnego konta' }, 400)
  }

  const sets: string[] = []
  const vals: unknown[] = []
  if (body.name !== undefined)   { sets.push('name = ?');   vals.push(body.name.trim()) }
  if (body.role !== undefined)   { sets.push('role = ?');   vals.push(body.role === 'admin' ? 'admin' : 'editor') }
  if (body.active !== undefined) { sets.push('active = ?'); vals.push(body.active ? 1 : 0) }

  if (!sets.length) return c.json({ error: 'No fields to update' }, 400)
  vals.push(id)

  const row = await c.env.DB.prepare(
    `UPDATE admin_users SET ${sets.join(', ')} WHERE id = ? RETURNING *`
  ).bind(...vals).first<AdminUserRow>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ user: row })
})

// DELETE /api/admin/users/:id — remove user
adminRouter.delete('/users/:id', requireAdmin, async (c) => {
  const me = c.get('user')
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare(
    'SELECT id, email FROM admin_users WHERE id = ?'
  ).bind(id).first<{ id: number; email: string }>()

  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.email.toLowerCase() === me.email.toLowerCase()) {
    return c.json({ error: 'Nie możesz usunąć własnego konta' }, 400)
  }

  await c.env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ── Storage stats ─────────────────────────────────────────────────────────────

// GET /api/admin/stats/storage — real R2 usage + D1 row counts
adminRouter.get('/stats/storage', requireAdmin, async (c) => {
  let totalBytes = 0
  let totalFiles = 0
  let cursor: string | undefined

  do {
    const listing = await c.env.MEDIA.list({ limit: 1000, ...(cursor ? { cursor } : {}) })
    for (const obj of listing.objects) {
      totalBytes += obj.size
      totalFiles++
    }
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)

  const db = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM gallery_albums) as albums,
      (SELECT COUNT(*) FROM gallery_photos) as photos,
      (SELECT COUNT(*) FROM news) as news,
      (SELECT COUNT(*) FROM documents) as documents,
      (SELECT COUNT(*) FROM menu_weeks) as menu_weeks
  `).first<Record<string, number>>()

  return c.json({ bytes: totalBytes, files: totalFiles, db: db ?? {} })
})

// ── Cache ─────────────────────────────────────────────────────────────────────

// POST /api/admin/cache/purge — globally purge all cached responses via CF API
adminRouter.post('/cache/purge', requireAdmin, async (c) => {
  const zoneId = c.env.CF_ZONE_ID
  const token  = c.env.CF_PURGE_TOKEN
  if (!zoneId || !token) {
    return c.json({
      error: 'CF_ZONE_ID lub CF_PURGE_TOKEN nie są skonfigurowane w ustawieniach Workera.',
      setup_needed: true
    }, 503)
  }
  const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purge_everything: true })
  })
  const data = await resp.json<{ success: boolean; errors?: Array<{ message: string }> }>()
  if (!resp.ok || !data.success) {
    const msg = data.errors?.[0]?.message ?? resp.statusText
    return c.json({ error: `CF API error: ${msg}` }, 502)
  }
  return c.json({ ok: true, message: 'Cache wyczyszczony globalnie. Zmiany będą widoczne za chwilę.' })
})
