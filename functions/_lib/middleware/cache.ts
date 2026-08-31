import type { Context, Next } from 'hono'
import type { Env } from '../types'

export async function cacheMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  await next()
  if (c.res.ok) {
    c.res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
  }
}
