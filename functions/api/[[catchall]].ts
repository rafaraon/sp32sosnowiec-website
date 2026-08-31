import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from '../_lib/types'

declare type PagesFunction<E = unknown> = (context: {
  request: Request
  env: E
  waitUntil: (promise: Promise<unknown>) => void
  passThroughOnException: () => void
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>
  params: Record<string, string | string[]>
  data: Record<string, unknown>
}) => Response | Promise<Response>
import { publicRouter } from '../_lib/routes/public'
import { cacheMiddleware } from '../_lib/middleware/cache'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE'] }))

app.use('/api/public/*', cacheMiddleware)
app.route('/api/public', publicRouter)

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

app.notFound((c) => c.json({ error: 'not found' }, 404))

export const onRequest: PagesFunction<Env> = (context) =>
  app.fetch(context.request, context.env, context as any)
