function _handleApiError(r, e) {
  if (r.status === 401 || r.status === 403 ||
      (e.error && (e.error === 'unauthorized' || e.error === 'Unauthorized'))) {
    _showSessionExpired()
    throw new Error('Sesja wygasła — zaloguj się ponownie.')
  }
  throw new Error(e.error || `HTTP ${r.status}`)
}

function _showSessionExpired() {
  let el = document.getElementById('_session-expired-banner')
  if (el) return
  el = document.createElement('div')
  el.id = '_session-expired-banner'
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#991b1b;color:#fff;' +
    'padding:.85rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:.88rem;font-weight:600'
  el.innerHTML = '⏱️ Sesja wygasła — musisz zalogować się ponownie.' +
    '<button onclick="location.reload()" style="background:#fff;color:#991b1b;border:none;' +
    'padding:.4rem .9rem;border-radius:6px;font-weight:800;cursor:pointer">Odśwież i zaloguj →</button>'
  document.body.prepend(el)
}

const API = {
  async get(path) {
    const r = await fetch('/api/admin' + path, { headers: adminHeaders() })
    if (!r.ok) { const e = await r.json().catch(() => ({})); _handleApiError(r, e) }
    return r.json()
  },
  async post(path, body) {
    const r = await fetch('/api/admin' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); _handleApiError(r, e) }
    return r.json()
  },
  async put(path, body) {
    const r = await fetch('/api/admin' + path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); _handleApiError(r, e) }
    return r.json()
  },
  async patch(path, body) {
    const r = await fetch('/api/admin' + path, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); _handleApiError(r, e) }
    return r.json()
  },
  async delete(path) {
    const r = await fetch('/api/admin' + path, { method: 'DELETE', headers: adminHeaders() })
    if (!r.ok) { const e = await r.json().catch(() => ({})); _handleApiError(r, e) }
    return r.json()
  },
  async postForm(path, formData) {
    const r = await fetch('/api/admin' + path, { method: 'POST', headers: adminHeaders(), body: formData })
    if (!r.ok) { const e = await r.json().catch(() => ({})); _handleApiError(r, e) }
    return r.json()
  }
}

function adminHeaders() {
  try {
    const secret = localStorage.getItem('admin_dev_secret')
    const email = localStorage.getItem('admin_dev_email')
    if (secret && email) return { 'X-Admin-Secret': secret, 'X-Admin-Email': email }
  } catch {}
  return {}
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/ą/g,'a').replace(/ć/g,'c').replace(/ę/g,'e').replace(/ł/g,'l')
    .replace(/ń/g,'n').replace(/ó/g,'o').replace(/ś/g,'s').replace(/ź|ż/g,'z')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
