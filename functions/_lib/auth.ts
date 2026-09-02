import type { Context, Next } from 'hono'
import type { Env, AdminUser, AdminRole, AdminUserRow } from './types'

function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const raw = parts[1] + '==='.slice(0, (4 - parts[1].length % 4) % 4)
    const payload = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(payload)
  } catch {
    return null
  }
}

async function resolveUserFromDB(
  db: D1Database,
  email: string,
  adminEmail: string
): Promise<AdminUser | null> {
  const row = await db.prepare(
    'SELECT role, active FROM admin_users WHERE email = ? COLLATE NOCASE LIMIT 1'
  ).bind(email).first<{ role: AdminRole; active: number }>()

  if (row) {
    if (!row.active) return null
    return { email, role: row.role }
  }

  // Super-admin auto-seed: first login of ADMIN_EMAIL creates their record
  if (email.toLowerCase() === adminEmail.toLowerCase()) {
    await db.prepare(
      `INSERT OR IGNORE INTO admin_users (email, name, role, active, created_by)
       VALUES (?, 'Administrator', 'admin', 1, 'system')`
    ).bind(email).run()
    return { email, role: 'admin' }
  }

  // Unknown email — deny (even with valid CF Access JWT)
  return null
}

export async function adminAuth(
  c: Context<{ Bindings: Env; Variables: { user: AdminUser } }>,
  next: Next
): Promise<void | Response> {
  // Local dev bypass
  const devSecret = c.req.header('x-admin-secret')
  if (c.env.DEV_MODE === '1' && devSecret && devSecret === c.env.ADMIN_SECRET) {
    const email = c.req.header('x-admin-email') ?? c.env.ADMIN_EMAIL
    const user = await resolveUserFromDB(c.env.DB, email, c.env.ADMIN_EMAIL)
    c.set('user', user ?? { email, role: email === c.env.ADMIN_EMAIL ? 'admin' : 'editor' })
    return next()
  }

  // CF Access JWT
  const jwt = c.req.header('cf-access-jwt-assertion')
  if (!jwt) return c.json({ error: 'unauthorized' }, 401)

  const payload = jwtPayload(jwt)
  if (!payload || typeof payload['email'] !== 'string') {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const email = payload['email']
  const user = await resolveUserFromDB(c.env.DB, email, c.env.ADMIN_EMAIL)
  if (!user) return c.json({ error: 'forbidden' }, 403)

  c.set('user', user)
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
