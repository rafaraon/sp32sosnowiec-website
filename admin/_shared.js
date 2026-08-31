const API = {
  async get(path) {
    const r = await fetch('/api/admin' + path, { headers: adminHeaders() })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  async post(path, body) {
    const r = await fetch('/api/admin' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
    return r.json()
  },
  async put(path, body) {
    const r = await fetch('/api/admin' + path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
    return r.json()
  },
  async delete(path) {
    const r = await fetch('/api/admin' + path, { method: 'DELETE', headers: adminHeaders() })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  },
  async postForm(path, formData) {
    const r = await fetch('/api/admin' + path, { method: 'POST', headers: adminHeaders(), body: formData })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
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
