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

/* Zamknij drawer po kliknięciu linku nawigacyjnego */
_mobDrawer?.addEventListener('click', e => {
  if (e.target.closest('.mob-link, .mob-sub') && !e.target.closest('[data-open-contact]')) {
    closeMob();
  }
});

/* Wstrzyknij sekcję dostępności do szuflady mobilnej */
(function() {
  const mobBody = _mobDrawer?.querySelector('.mob-body');
  if (!mobBody || mobBody.querySelector('.mob-a11y')) return;
  mobBody.insertAdjacentHTML('beforeend', `
    <hr class="mob-divider">
    <div class="mob-a11y" style="padding:.4rem .75rem .8rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
      <span style="font-size:.65rem;font-weight:700;color:var(--tx-m);font-family:var(--font-d);text-transform:uppercase;letter-spacing:.08em;flex:1 0 100%;margin-bottom:.15rem">Dostępność</span>
      <button class="a11y-btn" aria-label="Zwiększ czcionkę" style="background:var(--clv-l);color:var(--tx);border-color:var(--bd)">A+</button>
      <button class="a11y-btn" aria-label="Zmniejsz czcionkę" style="background:var(--clv-l);color:var(--tx);border-color:var(--bd)">A−</button>
      <button class="a11y-btn" aria-label="Wysoki kontrast" title="Wysoki kontrast" style="background:var(--clv-l);color:var(--tx);border-color:var(--bd)">◐</button>
    </div>
  `);
  /* Listenery obsłuży główny a11y init poniżej (unika podwójnego toggle) */
})();

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
      else if (lbl.includes('kontrast')) { root.classList.toggle('high-contrast'); if (btn.closest('.mob-a11y')) closeMob(); }
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

/* ── Scroll-reveal observer (global, wszystkie strony) ────────── */
(function() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });

  window._sp32Reveal = function() {
    document.querySelectorAll('.reveal:not(.visible)').forEach(el => io.observe(el));
  };
  window._sp32Reveal();
})();

/* ── Counter animation (.stat-number) ─────────────────────────── */
(function() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target;
      const raw = el.textContent.trim();
      const prefix = raw.match(/^[^\d]*/)[0];   /* "~" lub "" */
      const suffix = raw.match(/[^\d]*$/)[0];   /* "+" lub "" */
      const target = parseInt(raw.replace(/\D/g, ''), 10);
      if (!target) return;
      const dur = 1400;
      const t0 = performance.now();
      (function tick(now) {
        const p = Math.min((now - t0) / dur, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + Math.floor(ease * target) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(performance.now());
    });
  }, { threshold: 0.6 });

  window._sp32Counters = function() {
    document.querySelectorAll('.stat-number').forEach(el => {
      el.dataset.rawCount = el.dataset.rawCount || el.textContent.trim();
      el.textContent = el.dataset.rawCount; /* reset */
      io.observe(el);
    });
  };
  window._sp32Counters();
})();

/* ── 3D Card tilt on hover (desktop only) ─────────────────────── */
(function() {
  if (window.matchMedia('(hover: none)').matches) return; /* skip touch */
  const SEL = '.news-card, .stat-card, .album-card';
  const MAX = 7;

  function bindTilt(card) {
    if (card._tilt) return;
    card._tilt = true;
    card.style.willChange = 'transform';

    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width  - .5;
      const y = (e.clientY - r.top)  / r.height - .5;
      card.style.transition = 'transform .08s ease';
      card.style.transform  = `perspective(700px) rotateY(${x*MAX*2}deg) rotateX(${-y*MAX}deg) scale(1.03)`;
      card.style.boxShadow  = `${-x*8}px ${y*8}px 28px rgba(45,26,8,.18)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform .4s ease, box-shadow .4s ease';
      card.style.transform  = '';
      card.style.boxShadow  = '';
    });
  }

  window._sp32Tilt = function() {
    document.querySelectorAll(SEL).forEach(bindTilt);
  };
  window._sp32Tilt();
})();

/* ── Mobile splash screen ──────────────────────────────────────── */
(function() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const key = 'sp32-splash-v2';
  if (!isMobile || sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  const hour = new Date().getHours();
  const greeting =
    hour >= 5  && hour < 12 ? 'Dzień dobry! 👋' :
    hour >= 12 && hour < 18 ? 'Cześć! 👋' :
    hour >= 18 && hour < 22 ? 'Dobry wieczór! 👋' :
    'Dobranoc! 🌙';

  const splash = document.createElement('div');
  splash.id = 'sp32-splash';
  splash.setAttribute('aria-hidden', 'true');
  splash.innerHTML = `
    <img class="sp-logo" src="/grafiki-ai/logo-sp32.png" alt="" draggable="false">
    <span class="sp-greeting">${greeting}</span>
    <span class="sp-name">Szkoła Podstawowa nr 32<br>im. L. Kruczkowskiego · Sosnowiec</span>
  `;
  document.body.prepend(splash);
  document.body.style.overflow = 'hidden';

  function removeSplash() {
    splash.classList.add('sp32-exit');
    /* gwarantowane usunięcie po czasie animacji, niezależnie od animationend */
    setTimeout(() => {
      splash.remove();
      document.body.style.overflow = '';
    }, 520);
  }

  setTimeout(removeSplash, 1050);
})();

/* ── Ripple effect na przyciskach CTA ─────────────────────────── */
document.addEventListener('pointerdown', e => {
  const btn = e.target.closest('.btn-prim, .btn-edupage, .btn-ripple');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const wave = document.createElement('span');
  wave.className = 'ripple-wave';
  wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px`;
  btn.appendChild(wave);
  wave.addEventListener('animationend', () => wave.remove(), { once: true });
});

/* ── SPA navigation — content swap z animacją ─────────────────── */
(function() {
  /* oznacz style z początkowej strony, żeby ich nie usuwać */
  document.head.querySelectorAll('style').forEach(s => s.setAttribute('data-spa-initial', '1'));
  const SKIP = new Set(['.pdf', '.docx', '.xlsx', '.jpg', '.png', '.zip', '.mp4']);
  const origin = location.origin;

  function isInternal(href) {
    if (!href) return false;
    try {
      const u = new URL(href, origin);
      if (u.origin !== origin) return false;
      const ext = u.pathname.slice(u.pathname.lastIndexOf('.'));
      if (SKIP.has(ext)) return false;
      if (u.pathname.startsWith('/admin') || u.pathname.startsWith('/api')) return false;
      return true;
    } catch { return false; }
  }

  let _navigating = false;

  async function navigateTo(url, pushState = true) {
    if (_navigating) return;
    _navigating = true;

    const main = document.querySelector('main');
    const useVTA = !!document.startViewTransition;

    /* CSS fallback: fade-out before fetch (only when VTA unavailable) */
    if (!useVTA && main) {
      main.classList.add('sp-page-exit');
      await new Promise(r => setTimeout(r, 200));
    }

    try {
      const res = await fetch(url, { headers: { 'X-SPA': '1' } });
      if (!res.ok) { location.href = url; return; }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const newMain = doc.querySelector('main');
      if (!newMain) { location.href = url; return; }

      /* wszystkie zmiany DOM zebrać w jednej funkcji */
      const doUpdate = () => {
        if (main) {
          main.classList.remove('sp-page-exit');
          main.innerHTML = newMain.innerHTML;
          main.className = newMain.className;

          /* re-execute inline scripts z nowej strony */
          main.querySelectorAll('script').forEach(oldScript => {
            const s = document.createElement('script');
            [...oldScript.attributes].forEach(a => s.setAttribute(a.name, a.value));
            if (!oldScript.src) s.textContent = oldScript.textContent;
            oldScript.replaceWith(s);
          });

          /* re-init Alpine na nowej treści */
          if (window.Alpine) {
            main.querySelectorAll('[x-data]').forEach(el => {
              window.Alpine.initTree(el);
            });
          }

          /* CSS fallback enter animation (VTA handles its own) */
          if (!useVTA) {
            main.classList.add('sp-page-enter');
            main.addEventListener('animationend', () => main.classList.remove('sp-page-enter'), { once: true });
          }
        }

        document.title = doc.title;

        /* wstrzyknij style z <head> nowej strony (pomijaj już obecne) */
        document.head.querySelectorAll('style[data-spa-page]').forEach(el => el.remove());
        doc.head.querySelectorAll('style').forEach(s => {
          const clone = s.cloneNode(true);
          clone.setAttribute('data-spa-page', '1');
          document.head.appendChild(clone);
        });

        /* aktualizacja page-hero (jest poza <main>, więc trzeba osobno) */
        const currentHero = document.querySelector('.page-hero');
        const newHero     = doc.querySelector('.page-hero');
        if (newHero && currentHero) {
          const newTitle   = newHero.querySelector('.page-hero-title');
          const newEyebrow = newHero.querySelector('.page-hero-eyebrow');
          if (newTitle)   currentHero.querySelector('.page-hero-title')?.replaceWith(newTitle.cloneNode(true));
          if (newEyebrow) currentHero.querySelector('.page-hero-eyebrow')?.replaceWith(newEyebrow.cloneNode(true));
          currentHero.hidden = false;
        } else if (!newHero && currentHero) {
          currentHero.hidden = true;
        } else if (newHero && !currentHero) {
          document.querySelector('main')?.before(newHero.cloneNode(true));
        }

        /* aktualizacja breadcrumb (jest poza <main>) */
        const currentBW = document.querySelector('.breadcrumb-wrap');
        const newBW     = doc.querySelector('.breadcrumb-wrap');
        if (newBW && currentBW)   { currentBW.innerHTML = newBW.innerHTML; currentBW.hidden = false; }
        else if (!newBW && currentBW) { currentBW.hidden = true; }

        /* aktualizacja aktywnego linku w nav */
        const path = new URL(url, origin).pathname;
        document.querySelectorAll('.nav-link, .mob-nav-link').forEach(a => {
          try {
            const aPath = new URL(a.href, origin).pathname;
            a.classList.toggle('active', aPath === path);
          } catch {}
        });

        window.scrollTo({ top: 0, behavior: 'instant' });

        /* re-init global effects po zmianie strony */
        window._sp32Reveal?.();
        window._sp32Counters?.();
        window._sp32Tilt?.();
      };

      if (pushState) history.pushState({ url }, '', url);

      if (useVTA) {
        document.startViewTransition(doUpdate);
      } else {
        doUpdate();
      }

    } catch {
      location.href = url;
    } finally {
      _navigating = false;
    }
  }

  /* intercept kliknięcia */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank') return;
    const href = a.getAttribute('href');
    if (!href || href === '#' || href.startsWith('#')) return;
    if (!isInternal(href)) return;
    e.preventDefault();
    const url = new URL(href, origin).href;
    if (url === location.href) return;
    navigateTo(url);
  });

  /* back/forward button */
  window.addEventListener('popstate', e => {
    const url = e.state?.url || location.href;
    navigateTo(url, false);
  });
})();
