/* ═══════════════════════════════════════════════════════════════════
   SP32 Sosnowiec — Shared JavaScript
   Dołącz jako <script src="shared.js" defer></script> w każdej stronie.
═══════════════════════════════════════════════════════════════════ */

/* ── Scroll progress bar + back-to-top ─────────────────────────── */
const _bar = document.getElementById('scroll-bar');
const _btnTop = document.getElementById('back-top');
const _header = document.querySelector('.site-header');

window.addEventListener('scroll', () => {
  const progress = Math.min(
    (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100, 100
  );
  if (_bar) _bar.style.width = progress + '%';
  if (_btnTop) _btnTop.classList.toggle('visible', window.scrollY > 400);
  if (_header) _header.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* ── Desktop dropdown nav ──────────────────────────────────────── */
document.querySelectorAll('.has-dropdown > a').forEach(toggle => {
  toggle.addEventListener('click', e => {
    e.preventDefault();
    const li = toggle.parentElement;
    const isOpen = li.classList.contains('open');
    document.querySelectorAll('.has-dropdown.open').forEach(el => {
      el.classList.remove('open');
      el.querySelector('a')?.setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      li.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });
});
document.addEventListener('click', e => {
  if (!e.target.closest('.has-dropdown')) {
    document.querySelectorAll('.has-dropdown.open').forEach(el => {
      el.classList.remove('open');
      el.querySelector('a')?.setAttribute('aria-expanded', 'false');
    });
  }
});

/* ── Mobile hamburger menu ─────────────────────────────────────── */
const _hamburger = document.getElementById('nav-hamburger');
const _mobOverlay = document.getElementById('mob-overlay');
const _mobDrawer  = document.getElementById('mob-drawer');
const _mobClose   = document.getElementById('mob-close');

function openMob() {
  _hamburger?.setAttribute('aria-expanded', 'true');
  _mobOverlay?.classList.add('open'); _mobOverlay?.removeAttribute('aria-hidden');
  _mobDrawer?.classList.add('open');  _mobDrawer?.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
  _mobClose?.focus();
}
function closeMob() {
  _hamburger?.setAttribute('aria-expanded', 'false');
  _mobOverlay?.classList.remove('open'); _mobOverlay?.setAttribute('aria-hidden', 'true');
  _mobDrawer?.classList.remove('open');  _mobDrawer?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  _hamburger?.focus();
}
_hamburger?.addEventListener('click', openMob);
_mobOverlay?.addEventListener('click', closeMob);
_mobClose?.addEventListener('click', closeMob);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMob(); closeContact(); } });

/* ── Contact modal ─────────────────────────────────────────────── */
function openContact() {
  const ov = document.getElementById('contactOverlay');
  if (!ov) return;
  ov.removeAttribute('aria-hidden');
  ov.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('contactModalClose')?.focus(), 40);
}
function closeContact() {
  const ov = document.getElementById('contactOverlay');
  if (!ov) return;
  ov.setAttribute('aria-hidden', 'true');
  ov.classList.remove('open');
  document.body.style.overflow = '';
}
document.getElementById('contactModalClose')?.addEventListener('click', closeContact);
document.getElementById('contactOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'contactOverlay') closeContact();
});
document.querySelectorAll('[data-open-contact]').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); openContact(); });
});

/* ── A11y: rozmiar czcionki + wysoki kontrast ──────────────────── */
(function() {
  const root = document.documentElement;
  let size = parseFloat(getComputedStyle(root).fontSize) || 16;
  document.querySelectorAll('.a11y-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lbl = btn.getAttribute('aria-label') || '';
      if (lbl.includes('Zwiększ')) { size = Math.min(size + 2, 22); root.style.fontSize = size + 'px'; }
      else if (lbl.includes('Zmniejsz')) { size = Math.max(size - 2, 14); root.style.fontSize = size + 'px'; }
      else if (lbl.includes('kontrast')) { root.classList.toggle('high-contrast'); }
    });
  });
})();

/* ── Dark mode toggle ──────────────────────────────────────────── */
(function() {
  const stored = localStorage.getItem('sp32-theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  document.querySelectorAll('[data-toggle-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('sp32-theme', next); } catch {}
    });
  });
})();

/* ── Footer accordion: open on desktop, closed on mobile ──────── */
(function() {
  function syncFooterAccordion() {
    const isMobile = window.innerWidth <= 900;
    document.querySelectorAll('details.footer-info-card').forEach(d => {
      if (isMobile) d.removeAttribute('open');
      else d.setAttribute('open', '');
    });
  }
  syncFooterAccordion();
  window.addEventListener('resize', syncFooterAccordion, { passive: true });
})();
