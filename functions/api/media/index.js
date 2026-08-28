const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const isAdmin = (req, env) =>
  !!env.ADMIN_SECRET && req.headers.get('X-Admin-Key') === env.ADMIN_SECRET;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'all'; // 'images' | 'docs' | 'all'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);

  let where = '';
  if (type === 'images') where = "WHERE mime_type LIKE 'image/%'";
  if (type === 'docs')   where = "WHERE mime_type NOT LIKE 'image/%'";

  const { results } = await env.DB.prepare(
    `SELECT id, r2_key, url, filename, mime_type, size_bytes, uploaded_at
     FROM media ${where} ORDER BY uploaded_at DESC LIMIT ?`
  ).bind(limit).all();

  return json({ files: results });
}

export async function onRequestDelete({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { id } = await request.json();
  if (!id) return json({ error: 'id wymagane' }, 400);

  const { results } = await env.DB.prepare('SELECT r2_key FROM media WHERE id = ?').bind(id).all();
  if (!results.length) return json({ error: 'Nie znaleziono' }, 404);

  await env.MEDIA.delete(results[0].r2_key);
  await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id).run();

  return json({ ok: true });
}
