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

  if (category === 'zfss') return c.json({ error: 'forbidden' }, 403)

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
