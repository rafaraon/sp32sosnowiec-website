# Dokumentacja — Szkolny System CMS

> Projekt zbudowany dla SP32 Sosnowiec. Dokument opisuje architekturę, konfigurację i sposób powielenia dla kolejnych szkół.

---

## 1. Co to jest

Kompletny system zarządzania treścią dla szkoły podstawowej, działający w całości na infrastrukturze Cloudflare (Pages + Workers + D1 + R2). Bez dedykowanego serwera, bez VPS, bez bazy danych na własnym hostingu.

**Wyróżnik na tle innych szkół:** wbudowany Panel RODO z pełną obsługą wniosków o usunięcie/anonimizację zdjęć — zgodny z art. 17 RODO, z automatycznym powiadomieniem e-mail. Żadna inna szkoła podstawowa w Polsce nie ma takiego systemu.

---

## 2. Stack technologiczny

| Warstwa | Technologia | Rola |
|---|---|---|
| Hosting | Cloudflare Pages | Serwowanie statycznych plików HTML |
| Backend | Cloudflare Pages Functions (Hono) | API REST, logika biznesowa |
| Baza danych | Cloudflare D1 (SQLite) | Treści, galeria, wnioski RODO |
| Storage | Cloudflare R2 | Zdjęcia, dokumenty PDF, jadłospisy |
| CDN / cache | Cloudflare (wbudowany) | Cache-Control, purge API |
| Auth admin | Cloudflare Access (Zero Trust) | OTP przez e-mail, bez haseł |
| JWT weryfikacja | Web Crypto API (wbudowany w Workers) | Weryfikacja podpisu tokenu CF Access |
| Frontend admin | Alpine.js v3 | Reaktywny UI panelu admina |
| Frontend publiczny | Vanilla JS + Jinja2 build | Szybkie, lekkie strony |
| E-mail | Resend.com API | Powiadomienia RODO (admin + rodzic) |
| Cron | Cloudflare Workers Cron Trigger | Coroczny audit RODO galerii |

**Koszt miesięczny:** ~0 zł (wszystko na darmowych tierach Cloudflare + Resend free 3 000 maili/mies.)  
**Koszt roczny / co 2 lata:** opłata serwisowa za konfigurację i utrzymanie.

---

## 3. Moduły systemu

### 3.1 Aktualności
- CRUD z panelu admina (tytuł, treść HTML, okładka, kategoria, planowanie publikacji)
- Publiczne API: `GET /api/public/news`, `GET /api/public/news/:slug`
- Strona: `aktualnosci.html`, `artykul.html` (dynamiczne przez JS)

### 3.2 Galeria zdjęć
- Albumy z okładką, etykietą klasy, rokiem szkolnym
- Upload wielu zdjęć naraz do R2 (miniaturki generowane automatycznie)
- Anonimizacja zdjęcia (ukrycie z galerii publicznej) lub trwałe usunięcie
- Publiczne API: `GET /api/public/gallery`, `GET /api/public/gallery/:slug`

### 3.3 Dokumenty
- Kategorie: `dokumenty`, `zfss`, `druki`, `rodo`
- Upload PDF do R2, sortowanie, widoczność (published/unpublished)
- Admin widzi też niepublikowane (fix H2)

### 3.4 Jadłospis
- Upload PDF tygodniowego menu
- Wyświetlanie aktualnego tygodnia automatycznie
- Upsert po tygodniu (jedna pozycja/tydzień)

### 3.5 Specjaliści
- Psycholog, pedagog, doradca zawodowy, pielęgniarka
- Godziny przyjęć w formacie JSON (dzień, od-do)

### 3.6 Panel RODO ⭐
Patrz sekcja 6.

### 3.7 Zarządzanie użytkownikami
- Role: `admin` (pełny dostęp) i `editor` (aktualności + galeria)
- Nowi użytkownicy: admin dodaje e-mail, CF Access automatycznie obsługuje logowanie

---

## 4. Architektura

```
Przeglądarka rodzica/ucznia
    └── sp32sosnowiec.edu.pl (Cloudflare Pages CDN)
            ├── Pliki statyczne (HTML, CSS, JS, Alpine.js)
            └── /api/* → Pages Functions (Hono router)
                    ├── /api/public/* — bez auth
                    └── /api/admin/* — wymaga CF Access JWT
                            ├── DB: D1 (SQLite)
                            └── Storage: R2 (pliki)

Admin (przeglądarka)
    └── /admin/*.html → Alpine.js
            └── fetch('/api/admin/*') + CF Access Cookie
```

### Pliki kluczowe

```
functions/
  _lib/
    types.ts          # Env, interfejsy tabel D1
    auth.ts           # CF Access JWT weryfikacja + dev bypass
    db.ts             # Helpery: newsToJson, albumToJson, publicUrl()
    r2.ts             # uploadToR2(), r2Key()
    email.ts          # Resend API: notifyAdminNewRequest(), notifyParentResolved()
    routes/
      public.ts       # GET /api/public/* (bez auth)
      admin.ts        # GET/POST/PUT/DELETE /api/admin/* (requireAdmin)
  [[path]].ts         # Entry point: montuje publicRouter i adminRouter

workers/
  rodo-cron/
    index.ts          # Cron trigger: coroczny audit galerii (1 września, 8:00)

_src/
  _base.html          # Jinja2 base template (nav, stopka, CSS tokens)
  pages/
    *.html            # Szablony podstron (kompilowane przez build.py)

admin/
  *.html              # Panele admina (Alpine.js, serwowane statycznie)
  _shared.css         # Wspólne style panelu
  _shared.js          # API helper, fmtDate(), Alpine store

build.py              # Jinja2 build: _src/pages/*.html → *.html (root)
wrangler.toml         # Konfiguracja Cloudflare (D1, R2, zmienne, sekrety)
```

---

## 5. Konfiguracja od zera (nowa szkoła)

### Krok 1: Konta
- [ ] Cloudflare (bezpłatne) — cloudflare.com
- [ ] Resend (bezpłatne do 3 000 maili/mies.) — resend.com

### Krok 2: Cloudflare — domena
- Przenieś DNS domeny szkoły do Cloudflare (lub kup przez Cloudflare)
- Włącz Cloudflare Proxy (pomarańczowa chmurka) dla domeny głównej

### Krok 3: Cloudflare Pages
```bash
npx wrangler pages project create <nazwa-projektu>
npx wrangler pages deploy . --project-name <nazwa-projektu> --branch main
```
- W dashboardzie Pages: Settings → Custom domains → dodaj domenę szkoły

### Krok 4: D1 (baza danych)
```bash
npx wrangler d1 create <nazwa-db>
# Skopiuj database_id do wrangler.toml
npx wrangler d1 execute <nazwa-db> --remote --file=functions/_lib/migrations/0001_initial.sql
# Uruchom kolejne migracje 0002, 0003...
```

### Krok 5: R2 (storage)
```bash
npx wrangler r2 bucket create <nazwa-bucket>
# Dodaj publiczny dostęp do bucketa przez custom subdomenę (pub.domena.edu.pl)
```

### Krok 6: Cloudflare Access (logowanie admin)
- Zero Trust → Access → Applications → Add
- Typ: Self-hosted, URL: `domena.edu.pl/admin`
- Policy: Allow — E-mail — wpisz adresy nauczycieli
- Session duration: 1 miesiąc
- Skopiuj Team Domain do `wrangler.toml` → `CF_ACCESS_TEAM_DOMAIN`

### Krok 7: Sekrety
```bash
npx wrangler pages secret put ADMIN_SECRET --project-name <projekt>
npx wrangler pages secret put RESEND_API_KEY --project-name <projekt>
# Opcjonalnie:
npx wrangler pages secret put CF_PURGE_TOKEN --project-name <projekt>
```

### Krok 8: Resend — domena e-mail
- Resend dashboard → Domains → Add domain → wpisz domenę szkoły
- Kliknij „Auto configure" jeśli DNS w Cloudflare → rekordy dodają się automatycznie
- Wygeneruj API key (Sending access) → `wrangler secret put RESEND_API_KEY`

### Krok 9: Co zmienić w kodzie dla nowej szkoły

| Plik | Co zmienić |
|---|---|
| `wrangler.toml` | `name`, `database_name`, `database_id`, `ADMIN_EMAIL`, `MEDIA_PUBLIC_URL`, `CF_ACCESS_TEAM_DOMAIN`, `EMAIL_FROM` |
| `_src/_base.html` | Nazwa szkoły, adres, telefon, kolory (`--accent`) |
| `_src/pages/*.html` | Treść podstron (historia, dyrekcja, itp.) |
| `admin/rodo/index.html` | `DIRECTOR_EMAIL` (stała JS) |
| `functions/_lib/routes/public.ts` | URL panelu admina w powiadomieniu e-mail |
| `build.py` | Lista stron w `PAGES[]` |

### Krok 10: Deploy
```bash
python3 build.py          # kompiluje szablony Jinja2
npx wrangler pages deploy . --project-name <projekt> --branch main --commit-dirty=true
```

---

## 6. System RODO — szczegóły

### Dlaczego jest ważny
Szkoły bez systemu muszą ręcznie przeszukiwać setki zdjęć i rozpoznawać uczniów — to kilka dni pracy. Problem narasta gdy zmienia się kadra: nowi nauczyciele nie znają uczniów ze starszych roczników. Naraża to szkołę na naruszenie RODO i skargi do UODO.

### Jak działa
1. Rodzic wypełnia formularz na `rodo-wniosek.html`
2. System generuje numer `RODO-YYYY-NNN` i automatycznie wyszukuje albumy pasujące do klasy i roku szkolnego
3. Admin dostaje e-mail powiadamiający o nowym wniosku
4. Rodzic dzwoni do sekretariatu z numerem referencyjnym (weryfikacja tożsamości)
5. Admin przegląda pasujące albumy w panelu, anonimizuje lub usuwa zdjęcia
6. Admin zmienia status na „Rozwiązany" → rodzic dostaje automatyczny e-mail z potwierdzeniem

### Typy wniosków
- **Wycofanie zgody** — zdjęcia ukryte z galerii publicznej (anonimizacja), pozostają w archiwum
- **Usunięcie** — trwałe usunięcie z galerii i R2, wymaga zatwierdzenia dyrektora

### Cron automatyczny
Każdego roku 1 września (godz. 8:00) cron Worker sprawdza czy galeria zawiera albumy których rocznik ukończenia szkoły:
- `graduation_year + 3 <= rok_bieżący` → typ **autonomia** (uczniowie są pełnoletni, potrzebna zgoda)
- `graduation_year <= rok_bieżący` → typ **retencja** (opuścili szkołę)

### API
```
POST /api/public/rodo/request       # Publiczne — złożenie wniosku
GET  /api/admin/rodo/requests       # Admin — lista wniosków (?status=pending|in_progress|resolved)
POST /api/admin/rodo/requests       # Admin — ręczne tworzenie
PUT  /api/admin/rodo/requests/:id   # Admin — zmiana statusu, notatki, zatwierdzenie dyrektora
GET  /api/admin/rodo/audit          # Admin — albumy do przeglądu RODO
```

---

## 7. Auth (jak działa logowanie)

Cloudflare Access wysyła OTP (jednorazowy kod) na e-mail nauczyciela. Po zalogowaniu CF ustawia cookie z podpisanym JWT. Każde żądanie do `/api/admin/*` trafia do `adminAuth` middleware który:

1. Wyciąga JWT z cookie `CF_Authorization`
2. Weryfikuje podpis przez JWKS (klucze publiczne CF Access, cache 1h)
3. Sprawdza e-mail w tabeli `admin_users` w D1
4. Ustawia w kontekście Hono: `{ email, role }`

Sesja trwa 1 miesiąc — nauczyciel loguje się raz i przez miesiąc nie potrzebuje kodu.

**Dev bypass:** gdy `DEV_MODE=1` i nagłówek `X-Admin-Secret: <wartość>` zgadza się z sekretem — pomija CF Access. Tylko lokalne testy.

---

## 8. Backup

```bash
# Kod źródłowy (bez node_modules)
tar -czf /Users/accept/Downloads/1-PROJEKTY/sp32sosnowiec/backup_$(date +%Y%m%d).tar.gz \
  --exclude='node_modules' --exclude='.wrangler' --exclude='*.log' \
  /Users/accept/Downloads/1-PROJEKTY/sp32sosnowiec

# Baza D1 (eksport do SQL)
npx wrangler d1 export sp32-db --remote --output=backup_d1_$(date +%Y%m%d).sql
```

Pliki R2 (zdjęcia, PDFy) — przez Cloudflare dashboard lub `wrangler r2 object get`.

---

## 9. Koszty (model dla jednej szkoły)

| Usługa | Free tier | Kiedy płatne |
|---|---|---|
| Cloudflare Pages | ∞ deployments, 500 build/mies. | Nigdy (dla tej skali) |
| Cloudflare Workers | 100 000 req/dzień | >100k req/dzień |
| Cloudflare D1 | 5 mln odczytów/mies., 100k zapisów | >5 mln odczytów |
| Cloudflare R2 | 10 GB storage, 10 mln GET/mies. | >10 GB (szacunek: 10 lat zanim) |
| Cloudflare Access | 50 użytkowników | >50 kont admin |
| Resend | 3 000 maili/mies. | Nigdy (szkoła wysyła <100/mies.) |

**Realny koszt:** 0 zł/miesiąc. Jedyne wydatki to ewentualna opłata za domenę i serwis.

---

## 10. Potencjał skalowania — projekt ogólnopolski

### Model SaaS dla szkół
System jest gotowy do powielenia. Każda szkoła to osobny projekt Cloudflare Pages z własną D1 i R2 — całkowita izolacja danych. Konfiguracja per szkoła zajmuje ~2-3h.

**Co trzeba zmienić dla projektu ogólnopolskiego:**
- Multitenant: jedna Pages Functions obsługuje wiele szkół (routing po domenie/subdomenie)
- Panel zarządzania szkołami (onboarding, billing)
- Szablon brandingowalny (kolory, logo, nazwa szkoły z config)
- Automatyczny provisioning D1 + R2 przez Cloudflare API
- Centralny RODO audit dla wszystkich szkół

**Przewagi konkurencyjne:**
1. Panel RODO — jedyne gotowe rozwiązanie dla szkół w Polsce
2. Bez serwera — zero utrzymania infrastruktury, zero downtime
3. Prostota — nauczyciel bez wiedzy technicznej obsługuje w 1 minutę
4. Koszt — wielokrotnie niższy niż EduPage, Librus, Vulcan dla funkcji strony
5. WCAG 2.1 ready (deklaracja dostępności w projekcie)

### Estymacja rynku
- ~14 000 szkół podstawowych w Polsce
- Strona szkolna + Panel RODO jako core product
- Potencjał rozszerzenia: e-dziennik integracja, komunikacja z rodzicami, zapisy na zajęcia

---

## 11. Znane ograniczenia i otwarte kwestie

| # | Opis | Priorytet |
|---|---|---|
| L4 | Cron RODO działa raz/rok (1 września). Rozważyć miesięczny lub kwartalny | Niski |
| L7 | CORS na endpointach admin: `origin: '*'` — niska waga bo chronione CF Access | Niski |
| Gap | Brak automatycznej anonimizacji/blur twarzy — admin robi to ręcznie | Przyszłość |
| Gap | Brak notyfikacji push/e-mail dla nauczyciela gdy rodzic wpiszę komentarz | Przyszłość |
| Gap | Brak wersjonowania treści (aktualności) | Przyszłość |
