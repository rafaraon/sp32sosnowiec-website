// Email notifications via Resend API (https://resend.com — free tier: 3 000/month)
// Setup: npx wrangler secret put RESEND_API_KEY
// Then verify sp32sosnowiec.edu.pl domain in Resend dashboard (adds one DNS TXT record)

interface EmailPayload {
  to: string
  subject: string
  html: string
}

async function sendViaResend(apiKey: string, from: string, payload: EmailPayload): Promise<void> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [payload.to], subject: payload.subject, html: payload.html }),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`Resend ${resp.status}: ${body}`)
  }
}

// ── templates ─────────────────────────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;
       line-height:1.6;color:#1A1718;background:#F3EFEC}
  .wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;
        box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .hd{background:#E8601C;padding:22px 28px;color:#fff;font-size:18px;font-weight:700;line-height:1.3}
  .hd small{display:block;font-size:11px;font-weight:400;opacity:.75;margin-bottom:4px;
             letter-spacing:.08em;text-transform:uppercase}
  .bd{padding:24px 28px}
  .ref{display:inline-block;background:#FFF1EB;border:1px solid #FDDECE;border-radius:5px;
       padding:3px 10px;font-family:monospace;font-size:13px;color:#C44D12;font-weight:700}
  .btn{display:inline-block;background:#E8601C;color:#fff;font-weight:700;font-size:14px;
       padding:10px 20px;border-radius:7px;text-decoration:none;margin-top:16px}
  .ft{background:#FAF8F7;border-top:1px solid #EDE9E7;padding:14px 28px;
      font-size:12px;color:#9A9098;line-height:1.5}
  p{margin:0 0 12px}
</style></head><body><div class="wrap">
${content}
<div class="ft">Szkoła Podstawowa nr 32 · Sosnowiec · sp32sosnowiec.edu.pl<br>
Ta wiadomość została wygenerowana automatycznie.</div>
</div></body></html>`
}

export function newRequestEmail(opts: {
  reference: string
  studentName: string
  requestType: 'withdrawal' | 'deletion'
  submitterEmail: string | null
  classLabel: string | null
  adminPanelUrl: string
}): string {
  const typeLabel = opts.requestType === 'deletion' ? 'Usunięcie zdjęć' : 'Wycofanie zgody'
  return baseTemplate(`
<div class="hd"><small>Nowy wniosek RODO</small>${typeLabel}: ${opts.studentName}</div>
<div class="bd">
  <p>Wpłynął nowy wniosek RODO wymagający obsługi.</p>
  <p>Numer referencyjny: <span class="ref">${opts.reference}</span></p>
  <table style="font-size:14px;border-collapse:collapse;width:100%">
    <tr><td style="padding:5px 0;color:#6A6068;width:140px">Uczeń</td><td>${opts.studentName}</td></tr>
    <tr><td style="padding:5px 0;color:#6A6068">Klasa</td><td>${opts.classLabel ?? '—'}</td></tr>
    <tr><td style="padding:5px 0;color:#6A6068">Typ wniosku</td><td>${typeLabel}</td></tr>
    <tr><td style="padding:5px 0;color:#6A6068">E-mail zgłaszającego</td><td>${opts.submitterEmail ?? '—'}</td></tr>
  </table>
  <p style="margin-top:16px;font-size:14px;color:#6A6068">Kolejny krok: zweryfikuj tożsamość zgłaszającego przez sekretariat, następnie obsłuż wniosek w panelu.</p>
  <a class="btn" href="${opts.adminPanelUrl}">Przejdź do panelu RODO →</a>
</div>`)
}

export function resolvedEmail(opts: {
  reference: string
  studentName: string
  requestType: 'withdrawal' | 'deletion'
  resolvedBy: string
}): string {
  const typeLabel = opts.requestType === 'deletion' ? 'usunięcia zdjęć' : 'wycofania zgody na zdjęcia'
  const actionLabel = opts.requestType === 'deletion'
    ? 'Zdjęcia zostały trwale usunięte z galerii szkolnej.'
    : 'Wizerunek ucznia został zanonimizowany (twarze zakryte) w galerii szkolnej.'
  return baseTemplate(`
<div class="hd"><small>SP32 Sosnowiec · Wniosek RODO</small>Wniosek rozpatrzony</div>
<div class="bd">
  <p>Szanowna Pani / Szanowny Panie,</p>
  <p>Informujemy, że Państwa wniosek ${typeLabel} dotyczący ucznia <strong>${opts.studentName}</strong> został rozpatrzony.</p>
  <p>Numer referencyjny: <span class="ref">${opts.reference}</span></p>
  <p>${actionLabel}</p>
  <p style="font-size:14px;color:#6A6068;margin-top:16px">
    W razie pytań prosimy o kontakt z sekretariatem szkoły:<br>
    <strong>tel. 32 363 12 50</strong> (pon–pt, 7:30–15:30)
  </p>
</div>`)
}

// ── public API ─────────────────────────────────────────────────────────────────

export async function notifyAdminNewRequest(env: {
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  ADMIN_EMAIL: string
}, opts: Parameters<typeof newRequestEmail>[0]): Promise<void> {
  if (!env.RESEND_API_KEY) return  // silently skip if not configured
  const from = env.EMAIL_FROM ?? `SP32 RODO <rodo@sp32sosnowiec.edu.pl>`
  await sendViaResend(env.RESEND_API_KEY, from, {
    to: env.ADMIN_EMAIL,
    subject: `[RODO] Nowy wniosek ${opts.reference} — ${opts.studentName}`,
    html: newRequestEmail(opts),
  })
}

export async function notifyParentResolved(env: {
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
}, to: string, opts: Parameters<typeof resolvedEmail>[0]): Promise<void> {
  if (!env.RESEND_API_KEY || !to) return
  const from = env.EMAIL_FROM ?? `SP32 Sosnowiec <rodo@sp32sosnowiec.edu.pl>`
  await sendViaResend(env.RESEND_API_KEY, from, {
    to,
    subject: `Wniosek RODO ${opts.reference} został rozpatrzony`,
    html: resolvedEmail(opts),
  })
}
