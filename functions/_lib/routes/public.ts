import { Hono } from 'hono'
import type { Env } from '../types'

export const publicRouter = new Hono<{ Bindings: Env }>()

publicRouter.get('/news', async (c) => c.json({ items: [] }))
publicRouter.get('/news/:slug', async (c) => c.json({ item: null }))
publicRouter.get('/gallery', async (c) => c.json({ albums: [] }))
publicRouter.get('/gallery/:slug', async (c) => c.json({ album: null, photos: [] }))
publicRouter.get('/documents/:category', async (c) => c.json({ documents: [] }))
publicRouter.get('/specialists', async (c) => c.json({ specialists: [] }))
publicRouter.get('/menu/current', async (c) => c.json({ menu: null }))
