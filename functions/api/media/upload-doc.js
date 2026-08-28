const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Admin-Key',
};
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const isAdmin = (req, env) =>
  !!env.ADMIN_SECRET && req.headers.get('X-Admin-Key') === env.ADMIN_SECRET;

const ALLOWED = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const MAX_MB = 50;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);

  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'Brak pliku' }, 400);
  if (!ALLOWED.includes(file.type)) return json({ error: 'Dozwolone: PDF, Word, Excel' }, 415);
  if (file.size > MAX_MB * 1024 * 1024) return json({ error: `Maksymalny rozmiar: ${MAX_MB} MB` }, 413);

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safe = file.name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
  const key = `dokumenty/${yyyy}/${mm}/${Date.now()}-${safe}`;

  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });

  const baseUrl = new URL(request.url).origin;
  const url = `${baseUrl}/media/${key}`;

  await env.DB.prepare(
    'INSERT INTO media (r2_key, url, filename, mime_type, size_bytes) VALUES (?,?,?,?,?)'
  ).bind(key, url, file.name, file.type, file.size).run();

  return json({ url, key, filename: file.name }, 201);
}
