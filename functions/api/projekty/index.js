const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  const url = new URL(request.url);
  const kategoria = url.searchParams.get('kategoria');
  const onlyActive = !isAdmin(request, env);

  let where = onlyActive ? 'WHERE aktywny = 1' : '';
  if (kategoria && kategoria !== 'wszystkie') {
    where += (where ? ' AND' : 'WHERE') + ` kategoria = ?`;
  }

  const query = `SELECT * FROM projekty ${where} ORDER BY kolejnosc ASC, tytul ASC`;
  const { results } = kategoria && kategoria !== 'wszystkie'
    ? await env.DB.prepare(query).bind(kategoria).all()
    : await env.DB.prepare(query).all();

  return json({ projekty: results });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
  const body = await request.json();
  const { tytul, opis, kategoria, icon, rok_od, rok_do, link, kolejnosc, aktywny } = body;
  if (!tytul) return json({ error: 'tytul wymagany' }, 400);

  const { results } = await env.DB.prepare(
    `INSERT INTO projekty (tytul,opis,kategoria,icon,rok_od,rok_do,link,kolejnosc,aktywny)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`
  ).bind(tytul, opis||null, kategoria||'ogolny', icon||'📌', rok_od||null, rok_do||null, link||null, kolejnosc||0, aktywny??1).all();

  return json({ id: results[0].id, ok: true }, 201);
}

export async function onRequestPut({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
  const body = await request.json();
  const { id, tytul, opis, kategoria, icon, rok_od, rok_do, link, kolejnosc, aktywny } = body;
  if (!id) return json({ error: 'id wymagane' }, 400);

  await env.DB.prepare(
    `UPDATE projekty SET tytul=?,opis=?,kategoria=?,icon=?,rok_od=?,rok_do=?,link=?,kolejnosc=?,aktywny=?
     WHERE id=?`
  ).bind(tytul, opis||null, kategoria||'ogolny', icon||'📌', rok_od||null, rok_do||null, link||null, kolejnosc||0, aktywny??1, id).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
  const { id } = await request.json();
  if (!id) return json({ error: 'id wymagane' }, 400);
  await env.DB.prepare('DELETE FROM projekty WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
