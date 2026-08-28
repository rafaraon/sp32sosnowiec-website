const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const isAdmin = (req, env) =>
  !!env.ADMIN_SECRET && req.headers.get('X-Admin-Key') === env.ADMIN_SECRET;

/** Returns the Monday of the week containing `date` (ISO string). */
function weekStart(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function currentWeekStart() {
  return weekStart(new Date().toISOString());
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const week = url.searchParams.get('week') || currentWeekStart();

  const { results } = await env.DB.prepare(
    'SELECT day_num, zupa, drugie, kompot, uwagi FROM jadlospis WHERE week_start = ? ORDER BY day_num'
  ).bind(week).all();

  return json({ week_start: week, entries: results });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json();
  const { week_start, entries } = body;

  if (!week_start || !Array.isArray(entries)) return json({ error: 'week_start i entries są wymagane' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start)) return json({ error: 'Nieprawidłowy format daty' }, 400);

  const stmts = entries.map(e =>
    env.DB.prepare(
      `INSERT INTO jadlospis (week_start, day_num, zupa, drugie, kompot, uwagi, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(week_start, day_num) DO UPDATE SET
         zupa=excluded.zupa, drugie=excluded.drugie,
         kompot=excluded.kompot, uwagi=excluded.uwagi,
         updated_at=excluded.updated_at`
    ).bind(week_start, e.day_num, e.zupa || null, e.drugie || null, e.kompot || null, e.uwagi || null)
  );

  await env.DB.batch(stmts);
  return json({ ok: true, week_start });
}
