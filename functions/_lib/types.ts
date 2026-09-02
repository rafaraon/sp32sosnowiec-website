export type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  ADMIN_EMAIL: string
  ADMIN_SECRET: string
  DEV_MODE?: string
  MEDIA_PUBLIC_URL: string
  CF_ZONE_ID?: string
  CF_PURGE_TOKEN?: string
}

export type AdminRole = 'admin' | 'editor'

export interface AdminUser {
  email: string
  role: AdminRole
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

export interface ConsentRequestRow {
  id: number
  student_name: string
  class_label: string | null
  graduation_year: number | null
  request_type: 'withdrawal' | 'deletion'
  requested_at: string
  resolved_at: string | null
  resolved_by: string | null
  status: 'pending' | 'in_progress' | 'resolved'
  notes: string | null
  submitter_type: 'parent' | 'student' | 'adult'
  submitter_email: string | null
  reference_number: string | null
  director_approved_at: string | null
  matched_albums: string | null // JSON string
}

export interface AdminUserRow {
  id: number
  email: string
  name: string
  role: AdminRole
  active: number
  created_at: string
  created_by: string | null
}

export function calcGraduationYear(schoolYear: string, classLabel: string | null): number {
  const endYear = parseInt(schoolYear.split('/')[1], 10)
  if (!classLabel) return endYear
  const classNum = parseInt(classLabel.replace(/\D/g, ''), 10)
  return endYear + (8 - classNum)
}
