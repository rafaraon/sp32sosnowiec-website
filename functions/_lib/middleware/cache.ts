import type { Context, Next } from 'hono'
import type { Env } from '../types'

export async function cacheMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  await next()
  if (c.res.ok) {
    // 30s edge TTL + 10s stale-while-revalidate — fresh enough for editorial updates
    c.res.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=10')
  }
}
