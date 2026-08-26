const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const isAdmin = (req, env) =>
  !!env.ADMIN_SECRET && req.headers.get('X-Admin-Key') === env.ADMIN_SECRET;
const slugify = s =>
  s.toLowerCase()
    .replace(/ą/g,'a').replace(/ć/g,'c').replace(/ę/g,'e').replace(/ł/g,'l')
    .replace(/ń/g,'n').replace(/ó/g,'o').replace(/ś/g,'s').replace(/[źż]/g,'z')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const admin = isAdmin(request, env);
  const status = admin ? (url.searchParams.get('status') || 'published') : 'published';
  const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '20'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const W      = status === 'all' ? '' : 'WHERE status = ?';
  const params = status === 'all' ? [] : [status];

  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, description, cover_url, status, published_at, created_at
     FROM galleries ${W}
     ORDER BY COALESCE(published_at, created_at) DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  const { results: [{ total }] } = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM galleries ${W}`
  ).bind(...params).all();

  // Attach image count per gallery
  const ids = results.map(g => g.id);
  let counts = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const { results: imgCounts } = await env.DB.prepare(
      `SELECT gallery_id, COUNT(*) as cnt FROM gallery_images WHERE gallery_id IN (${placeholders}) GROUP BY gallery_id`
    ).bind(...ids).all();
    imgCounts.forEach(r => { counts[r.gallery_id] = r.cnt; });
  }

  const galleries = results.map(g => ({ ...g, image_count: counts[g.id] ?? 0 }));

  return json({ galleries, total, limit, offset });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { title, description = null, cover_url = null, status = 'draft' } = await request.json();
  if (!title?.trim()) return json({ error: 'Tytuł jest wymagany' }, 400);

  const slug = slugify(title) + '-' + Date.now();
  const published_at = status === 'published' ? new Date().toISOString() : null;

  const { meta } = await env.DB.prepare(
    'INSERT INTO galleries (slug,title,description,cover_url,status,published_at) VALUES (?,?,?,?,?,?)'
  ).bind(slug, title.trim(), description, cover_url, status, published_at).run();

  return json({ id: meta.last_row_id, slug }, 201);
}
