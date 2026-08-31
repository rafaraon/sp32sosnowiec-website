import type { Context, Next } from 'hono'
import type { Env, AdminUser, AdminRole } from './types'

function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(payload)
  } catch {
    return null
  }
}

export function resolveRole(email: string, adminEmail: string): AdminRole {
  return email === adminEmail ? 'admin' : 'editor'
}

export async function adminAuth(
  c: Context<{ Bindings: Env; Variables: { user: AdminUser } }>,
  next: Next
): Promise<void | Response> {
  // Local dev bypass
  const devSecret = c.req.header('x-admin-secret')
  if (devSecret && devSecret === c.env.ADMIN_SECRET) {
    const email = c.req.header('x-admin-email') ?? c.env.ADMIN_EMAIL
    c.set('user', { email, role: resolveRole(email, c.env.ADMIN_EMAIL) })
    return next()
  }

  // CF Access JWT
  const jwt = c.req.header('cf-access-jwt-assertion')
  if (!jwt) return c.json({ error: 'unauthorized' }, 401)

  const payload = jwtPayload(jwt)
  if (!payload || typeof payload['email'] !== 'string') {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const email = payload['email'] as string
  c.set('user', { email, role: resolveRole(email, c.env.ADMIN_EMAIL) })
  return next()
}

export function requireAdmin(
  c: Context<{ Bindings: Env; Variables: { user: AdminUser } }>,
  next: Next
): Promise<void | Response> {
  const user = c.get('user')
  if (!user || user.role !== 'admin') return Promise.resolve(c.json({ error: 'forbidden' }, 403))
  return next()
}
