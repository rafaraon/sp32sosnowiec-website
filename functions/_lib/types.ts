export type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  ADMIN_EMAIL: string
  MEDIA_PUBLIC_URL: string
}

export interface NewsRow {
  id: number
  title: string
  slug: string
  excerpt: string | null
  body_html: string | null
  cover_r2_key: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  author_email: string | null
}

export interface GalleryAlbumRow {
  id: number
  title: string
  slug: string
  school_year: string
  class_label: string | null
  graduation_year: number
  event_date: string | null
  cover_r2_key: string | null
  published: number
  created_at: string
}

export interface GalleryPhotoRow {
  id: number
  album_id: number
  r2_key: string
  r2_key_thumb: string | null
  consent_ref: string | null
  graduation_year: number
  anonymized: number
  anonymized_at: string | null
  sort_order: number
  created_at: string
}

export interface DocumentRow {
  id: number
  category: 'dokumenty' | 'zfss' | 'druki' | 'rodo'
  title: string
  r2_key: string
  file_type: string | null
  file_size: number | null
  sort_order: number
  published: number
  uploaded_at: string
  uploaded_by: string | null
}

export interface SpecialistRow {
  id: number
  role: 'psycholog' | 'pedagog' | 'doradca' | 'pielegnarka'
  name: string
  title_prefix: string | null
  room: string | null
  phone_ext: string | null
  hours: string  // JSON string
  active: number
  updated_at: string
}

export interface MenuWeekRow {
  id: number
  week_start: string
  r2_key: string | null
  notes: string | null
  published: number
  created_at: string
}

export interface SpecialistHour {
  day: string
  from: string
  to: string
}

export function calcGraduationYear(schoolYear: string, classLabel: string | null): number {
  const endYear = parseInt(schoolYear.split('/')[1], 10)
  if (!classLabel) return endYear
  const classNum = parseInt(classLabel.replace(/\D/g, ''), 10)
  return endYear + (8 - classNum)
}
