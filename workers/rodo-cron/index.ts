export interface Env {
  DB: D1Database
  ADMIN_EMAIL: string
}

interface AuditAlbum {
  id: number
  title: string
  slug: string
  graduation_year: number
  audit_type: 'retention' | 'autonomy'
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAudit(env))
  }
}

async function runAudit(env: Env): Promise<void> {
  const currentYear = new Date().getFullYear()

  const rows = await env.DB.prepare(
    `SELECT id, title, slug, graduation_year,
       CASE WHEN graduation_year + 3 <= ? THEN 'autonomy' ELSE 'retention' END as audit_type
     FROM gallery_albums
     WHERE graduation_year <= ?
     ORDER BY graduation_year ASC`
  ).bind(currentYear, currentYear).all<AuditAlbum>()

  const albums = rows.results ?? []

  await env.DB.prepare(
    `INSERT INTO rodo_audit_log (albums_count, payload) VALUES (?, ?)`
  ).bind(albums.length, JSON.stringify(albums)).run()

  console.log(`[RODO Cron] ${new Date().toISOString()} — ${albums.length} albumów wymaga uwagi`)
  for (const a of albums) {
    console.log(`  [${a.audit_type.toUpperCase()}] ${a.title} (graduation_year: ${a.graduation_year})`)
  }
}
