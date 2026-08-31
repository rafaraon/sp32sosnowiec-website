import { Hono } from 'hono'
import type { Env, NewsRow, GalleryAlbumRow, GalleryPhotoRow, DocumentRow, SpecialistRow, MenuWeekRow } from '../types'
import { newsToJson, albumToJson, photoToJson } from '../db'

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

// Stubs — will be replaced in Task 7
publicRouter.get('/documents/:category', async (c) => c.json({ documents: [] }))
publicRouter.get('/specialists', async (c) => c.json({ specialists: [] }))
publicRouter.get('/menu/current', async (c) => c.json({ menu: null }))
