const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const isAdmin = (req, env) =>
  !!env.ADMIN_SECRET && req.headers.get('X-Admin-Key') === env.ADMIN_SECRET;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ params, request, env }) {
  const { id } = params;
  const admin = isAdmin(request, env);
  const col = isNaN(Number(id)) ? 'slug' : 'id';

  const { results } = await env.DB.prepare(
    `SELECT * FROM galleries WHERE ${col} = ? LIMIT 1`
  ).bind(id).all();

  if (!results.length) return json({ error: 'Nie znaleziono' }, 404);
  const gallery = results[0];
  if (gallery.status === 'draft' && !admin) return json({ error: 'Nie znaleziono' }, 404);

  const { results: images } = await env.DB.prepare(
    'SELECT * FROM gallery_images WHERE gallery_id = ? ORDER BY sort_order, id'
  ).bind(gallery.id).all();

  return json({ ...gallery, images });
}

export async function onRequestPut({ params, request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const body = await request.json();

  const UPDATABLE = ['title','description','cover_url','status'];
  const sets   = [];
  const values = [];

  for (const field of UPDATABLE) {
    if (body[field] !== undefined) { sets.push(`${field} = ?`); values.push(body[field]); }
  }
  if (body.status === 'published') {
    const { results } = await env.DB.prepare('SELECT published_at FROM galleries WHERE id = ?').bind(id).all();
    if (results.length && !results[0].published_at) {
      sets.push('published_at = ?');
      values.push(new Date().toISOString());
    }
  }
  if (!sets.length) return json({ error: 'Brak pól do aktualizacji' }, 400);

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());

  await env.DB.prepare(`UPDATE galleries SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ params, request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  await env.DB.prepare('DELETE FROM galleries WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
