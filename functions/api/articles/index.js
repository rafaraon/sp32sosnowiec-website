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

  const status    = url.searchParams.get('status') || 'published';
  const category  = url.searchParams.get('category');
  const featured  = url.searchParams.get('featured');
  const search    = url.searchParams.get('search');
  const limit     = Math.min(parseInt(url.searchParams.get('limit')  || '20'), 100);
  const offset    = parseInt(url.searchParams.get('offset') || '0');

  // Non-admins can only see published
  const effectiveStatus = admin ? status : 'published';

  const where  = [];
  const params = [];

  if (effectiveStatus !== 'all') { where.push('status = ?'); params.push(effectiveStatus); }
  if (category)   { where.push('category = ?'); params.push(category); }
  if (featured === '1') { where.push('featured = 1'); }
  if (search)     { where.push('(title LIKE ? OR lead LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, lead, category, status, featured, cover_url, author, published_at, created_at
     FROM articles ${W}
     ORDER BY COALESCE(published_at, created_at) DESC
     LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  const { results: [{ total }] } = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM articles ${W}`
  ).bind(...params).all();

  return json({ articles: results, total, limit, offset });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json();
  const {
    title, lead, body: content, category = 'szkolne',
    status = 'draft', featured = 0, cover_url = null,
    cover_caption = null, author = 'Redakcja', tags = null,
  } = body;

  if (!title?.trim()) return json({ error: 'Tytuł jest wymagany' }, 400);

  const slug = slugify(title) + '-' + Date.now();
  const published_at = status === 'published' ? new Date().toISOString() : null;

  const { meta } = await env.DB.prepare(
    `INSERT INTO articles (slug,title,lead,body,category,status,featured,cover_url,cover_caption,author,tags,published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(slug, title.trim(), lead ?? null, content ?? null, category, status,
    featured ? 1 : 0, cover_url, cover_caption, author, tags, published_at).run();

  return json({ id: meta.last_row_id, slug }, 201);
}
