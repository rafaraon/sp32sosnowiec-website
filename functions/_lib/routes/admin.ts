import { Hono } from 'hono'
import type { Env, AdminUser, NewsRow, GalleryAlbumRow, GalleryPhotoRow } from '../types'
import { calcGraduationYear } from '../types'
import { adminAuth, requireAdmin } from '../auth'
import { newsToJson, albumToJson, photoToJson } from '../db'
import { r2Key, uploadToR2 } from '../r2'

type Variables = { user: AdminUser }

export const adminRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

adminRouter.use('*', adminAuth)

adminRouter.get('/me', (c) => {
  const user = c.get('user')
  return c.json({ email: user.email, role: user.role })
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
  }>()

  if (!body.title || !body.slug) {
    return c.json({ error: 'title and slug are required' }, 400)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO news (title, slug, excerpt, body_html, cover_r2_key, published_at, author_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      body.title,
      body.slug,
      body.excerpt ?? null,
      body.body_html ?? null,
      body.cover_r2_key ?? null,
      body.published_at ?? null,
      user.email
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
  }>>()

  const allowedKeys = ['title', 'slug', 'excerpt', 'body_html', 'cover_r2_key', 'published_at'] as const
  type AllowedKey = typeof allowedKeys[number]

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
    await c.env.MEDIA.delete(existing.cover_r2_key)
  }

  await c.env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run()

  return c.json({ ok: true })
})

// ── Gallery Albums ────────────────────────────────────────────────────────────

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
    event_date: string
    published: boolean | number
    cover_r2_key: string
  }>>()

  const allowedKeys = ['title', 'event_date', 'published', 'cover_r2_key'] as const
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
    await c.env.MEDIA.delete(photo.r2_key)
    if (photo.r2_key_thumb) {
      await c.env.MEDIA.delete(photo.r2_key_thumb)
    }
  }

  // D1 ON DELETE CASCADE removes photos; delete album
  await c.env.DB.prepare('DELETE FROM gallery_albums WHERE id = ?').bind(id).run()

  return c.json({ ok: true })
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
