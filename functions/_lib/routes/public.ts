import { Hono } from 'hono'
import type { Env, NewsRow, GalleryAlbumRow, GalleryPhotoRow, DocumentRow, SpecialistRow, MenuWeekRow } from '../types'
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

// Stubs — will be replaced in Tasks 6-7
publicRouter.get('/gallery', async (c) => c.json({ albums: [] }))
publicRouter.get('/gallery/:slug', async (c) => c.json({ album: null, photos: [] }))
publicRouter.get('/documents/:category', async (c) => c.json({ documents: [] }))
publicRouter.get('/specialists', async (c) => c.json({ specialists: [] }))
publicRouter.get('/menu/current', async (c) => c.json({ menu: null }))
