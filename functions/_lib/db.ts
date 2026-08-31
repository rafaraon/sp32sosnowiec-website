import type { Env, NewsRow, GalleryAlbumRow, GalleryPhotoRow, DocumentRow, SpecialistRow, MenuWeekRow } from './types'

export function publicUrl(env: Env, key: string): string {
  return `${env.MEDIA_PUBLIC_URL}/${key}`
}

export function newsToJson(row: NewsRow, env: Env) {
  return {
    ...row,
    cover_url: row.cover_r2_key ? publicUrl(env, row.cover_r2_key) : null,
  }
}

export function albumToJson(row: GalleryAlbumRow, env: Env) {
  return {
    ...row,
    cover_url: row.cover_r2_key ? publicUrl(env, row.cover_r2_key) : null,
    published: row.published === 1,
  }
}

export function photoToJson(row: GalleryPhotoRow, env: Env) {
  return {
    ...row,
    url: publicUrl(env, row.r2_key),
    thumb_url: row.r2_key_thumb ? publicUrl(env, row.r2_key_thumb) : publicUrl(env, row.r2_key),
    anonymized: row.anonymized === 1,
  }
}

export function documentToJson(row: DocumentRow, env: Env) {
  return {
    ...row,
    url: publicUrl(env, row.r2_key),
    published: row.published === 1,
  }
}

export function specialistToJson(row: SpecialistRow) {
  return {
    ...row,
    hours: JSON.parse(row.hours),
    active: row.active === 1,
  }
}

export function menuToJson(row: MenuWeekRow, env: Env) {
  return {
    ...row,
    url: row.r2_key ? publicUrl(env, row.r2_key) : null,
    published: row.published === 1,
  }
}
