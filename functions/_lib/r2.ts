import type { Env } from './types'

export function r2Key(prefix: string, filename: string): string {
  const ts = Date.now()
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
  return `${prefix}/${ts}-${safe}`
}

export async function uploadToR2(
  env: Env,
  key: string,
  file: File | Blob,
  contentType?: string
): Promise<string> {
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: contentType ?? file.type },
  })
  return key
}

export async function deleteFromR2(env: Env, key: string): Promise<void> {
  await env.MEDIA.delete(key)
}
