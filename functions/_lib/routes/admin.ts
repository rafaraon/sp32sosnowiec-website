import { Hono } from 'hono'
import type { Env, AdminUser, NewsRow } from '../types'
import { adminAuth, requireAdmin } from '../auth'
import { newsToJson } from '../db'

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
