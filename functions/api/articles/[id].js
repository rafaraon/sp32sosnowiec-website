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
    `SELECT * FROM articles WHERE ${col} = ? LIMIT 1`
  ).bind(id).all();

  if (!results.length) return json({ error: 'Nie znaleziono' }, 404);

  const article = results[0];
  if (article.status === 'draft' && !admin) return json({ error: 'Nie znaleziono' }, 404);

  return json(article);
}

export async function onRequestPut({ params, request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const body = await request.json();

  const UPDATABLE = ['title','lead','body','category','status','featured','cover_url','cover_caption','author','tags'];
  const sets   = [];
  const values = [];

  for (const field of UPDATABLE) {
    if (body[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(field === 'featured' ? (body[field] ? 1 : 0) : body[field]);
    }
  }

  // Set published_at the first time an article is published
  if (body.status === 'published') {
    const { results } = await env.DB.prepare(
      'SELECT published_at FROM articles WHERE id = ?'
    ).bind(id).all();
    if (results.length && !results[0].published_at) {
      sets.push('published_at = ?');
      values.push(new Date().toISOString());
    }
  }

  if (!sets.length) return json({ error: 'Brak pól do aktualizacji' }, 400);

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());

  await env.DB.prepare(
    `UPDATE articles SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...values, id).run();

  return json({ ok: true });
}

export async function onRequestDelete({ params, request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
