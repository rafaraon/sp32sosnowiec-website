import type { Context, Next } from 'hono'
import type { Env, AdminUser, AdminRole, AdminUserRow } from './types'

// In-memory JWKS cache (lives for the lifetime of the isolate, ~1 hour TTL)
let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null
const JWKS_TTL_MS = 3_600_000

async function fetchJwks(teamDomain: string): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys
  const resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!resp.ok) throw new Error('JWKS fetch failed')
  const jwks = await resp.json() as { keys: JsonWebKey[] }
  jwksCache = { keys: jwks.keys, fetchedAt: Date.now() }
  return jwks.keys
}

// Verifies CF Access JWT signature via JWKS; returns payload or null on any failure
async function verifyJwt(token: string, teamDomain: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const b64pad = (s: string) => s + '==='.slice(0, (4 - s.length % 4) % 4)
    const b64decode = (s: string) => atob(b64pad(s).replace(/-/g, '+').replace(/_/g, '/'))
    const header = JSON.parse(b64decode(parts[0])) as { kid?: string }
    const payload = JSON.parse(b64decode(parts[1])) as Record<string, unknown>
    if (typeof payload['exp'] === 'number' && payload['exp'] < Math.floor(Date.now() / 1000)) return null
    const keys = await fetchJwks(teamDomain)
    const jwk = keys.find((k: any) => k.kid === header.kid)
    if (!jwk) return null
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    )
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const sig = Uint8Array.from(b64decode(parts[2]), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data)
    return valid ? payload : null
  } catch {
    return null
  }
}

// Fallback: decode payload only (no signature check) — used when CF_ACCESS_TEAM_DOMAIN is not set
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
  // DEV_MODE bypass — only active when DEV_MODE='1' in wrangler.jsonc (never set in production).
  // Send header X-Admin-Secret matching the ADMIN_SECRET binding to skip CF Access JWT verification.
  // Optionally send X-Admin-Email to impersonate a specific user; defaults to ADMIN_EMAIL.
  const devSecret = c.req.header('x-admin-secret')
  if (c.env.DEV_MODE === '1' && devSecret && devSecret === c.env.ADMIN_SECRET) {
    const email = c.req.header('x-admin-email') ?? c.env.ADMIN_EMAIL
    const user = await resolveUserFromDB(c.env.DB, email, c.env.ADMIN_EMAIL)
    c.set('user', user ?? { email, role: email === c.env.ADMIN_EMAIL ? 'admin' : 'editor' })
    return next()
  }

  // CF Access JWT — verify signature when CF_ACCESS_TEAM_DOMAIN is configured
  const jwt = c.req.header('cf-access-jwt-assertion')
  if (!jwt) return c.json({ error: 'unauthorized' }, 401)

  const payload = c.env.CF_ACCESS_TEAM_DOMAIN
    ? await verifyJwt(jwt, c.env.CF_ACCESS_TEAM_DOMAIN)
    : jwtPayload(jwt)
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
