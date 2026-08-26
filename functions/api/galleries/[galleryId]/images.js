const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const isAdmin = (req, env) =>
  !!env.ADMIN_SECRET && req.headers.get('X-Admin-Key') === env.ADMIN_SECRET;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ params, env }) {
  const { galleryId } = params;
  const { results } = await env.DB.prepare(
    'SELECT * FROM gallery_images WHERE gallery_id = ? ORDER BY sort_order, id'
  ).bind(galleryId).all();
  return json({ images: results });
}

export async function onRequestPost({ params, request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { galleryId } = params;
  const { url, caption = null, sort_order = 0 } = await request.json();
  if (!url) return json({ error: 'URL zdjęcia jest wymagany' }, 400);

  const { meta } = await env.DB.prepare(
    'INSERT INTO gallery_images (gallery_id,url,caption,sort_order) VALUES (?,?,?,?)'
  ).bind(galleryId, url, caption, sort_order).run();

  // Set gallery cover to first image if not set
  await env.DB.prepare(
    'UPDATE galleries SET cover_url = ? WHERE id = ? AND cover_url IS NULL'
  ).bind(url, galleryId).run();

  return json({ id: meta.last_row_id }, 201);
}

export async function onRequestDelete({ params, request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const imageId = url.searchParams.get('imageId');
  if (!imageId) return json({ error: 'imageId wymagany' }, 400);

  await env.DB.prepare(
    'DELETE FROM gallery_images WHERE id = ? AND gallery_id = ?'
  ).bind(imageId, params.galleryId).run();

  return json({ ok: true });
}
