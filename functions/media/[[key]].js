export async function onRequestGet({ params, env }) {
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key;
  const object = await env.MEDIA.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
}
