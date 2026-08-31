#!/usr/bin/env python3
"""
SP32 Sosnowiec — Jinja2 build script
Renderuje wszystkie podstrony z _src/pages/*.html do katalogu głównego.

Użycie:
    python3 build.py               # buduje wszystkie strony
    python3 build.py historia.html # buduje tylko jedną stronę

Wymagania:
    pip install jinja2

Workflow:
    1. Edytuj _src/_base.html  (nav, stopka, shared HTML)
    2. Edytuj _src/pages/*.html (treść konkretnej strony)
    3. python3 build.py
    4. git add . && git commit && git push
"""

import sys
import os
from jinja2 import Environment, FileSystemLoader, select_autoescape

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguracja ścieżek
# ─────────────────────────────────────────────────────────────────────────────
SRC_DIR    = os.path.join(os.path.dirname(__file__), "_src")
PAGES_DIR  = os.path.join(SRC_DIR, "pages")
OUTPUT_DIR = os.path.dirname(__file__)  # root projektu

# ─────────────────────────────────────────────────────────────────────────────
# Jinja2 environment
# ─────────────────────────────────────────────────────────────────────────────
env = Environment(
    loader=FileSystemLoader(SRC_DIR),
    autoescape=select_autoescape(disabled_extensions=("html",)),
    keep_trailing_newline=True,
)

# ─────────────────────────────────────────────────────────────────────────────
# Metadane stron
# Format: (plik_szablonu, plik_wyjściowy, kontekst)
# Kontekst trafia do szablonu jako zmienne Jinja2.
# Bloki {% block %} w szablonach mają pierwszeństwo nad kontekstem.
# ─────────────────────────────────────────────────────────────────────────────
PAGES = [
    # ── Nasza Szkoła ─────────────────────────────────────────────────────────
    ("historia.html", "historia.html", {
        "breadcrumb_section": "Nasza Szkoła",
        "active_nav": "nasza-szkola",
    }),
    ("profil.html", "profil.html", {
        "breadcrumb_section": "Nasza Szkoła",
        "active_nav": "nasza-szkola",
    }),
    ("dyrekcja.html", "dyrekcja.html", {
        "breadcrumb_section": "Nasza Szkoła",
        "active_nav": "nasza-szkola",
    }),
    ("sukcesy.html", "sukcesy.html", {
        "breadcrumb_section": "",
        "active_nav": "nasza-szkola",
    }),
    ("galeria.html", "galeria.html", {
        "breadcrumb_section": "",
        "active_nav": "nasza-szkola",
    }),

    # ── Aktualności / Artykuł ─────────────────────────────────────────────────
    ("aktualnosci.html", "aktualnosci.html", {
        "breadcrumb_section": "",
        "active_nav": "aktualnosci",
    }),
    ("artykul.html", "artykul.html", {
        "breadcrumb_section": "Aktualności",
        "breadcrumb_section_href": "aktualnosci.html",
        "active_nav": "aktualnosci",
    }),

    # ── Uczniowie ─────────────────────────────────────────────────────────────
    ("biblioteka.html", "biblioteka.html", {
        "breadcrumb_section": "Uczniowie",
        "active_nav": "uczniowie",
    }),
    ("swietlica.html", "swietlica.html", {
        "breadcrumb_section": "Uczniowie",
        "active_nav": "uczniowie",
    }),
    ("wolontariat.html", "wolontariat.html", {
        "breadcrumb_section": "Uczniowie",
        "active_nav": "uczniowie",
    }),
    ("dzwonki.html", "dzwonki.html", {
        "breadcrumb_section": "Uczniowie",
        "active_nav": "uczniowie",
    }),

    # ── Rodzice ───────────────────────────────────────────────────────────────
    ("jadlospis.html", "jadlospis.html", {
        "breadcrumb_section": "",
        "active_nav": "rodzice",
    }),
    ("psycholog.html", "psycholog.html", {
        "breadcrumb_section": "",
        "active_nav": "rodzice",
    }),
    ("pedagog.html", "pedagog.html", {
        "breadcrumb_section": "Rodzice",
        "active_nav": "rodzice",
    }),
    ("doradca.html", "doradca.html", {
        "breadcrumb_section": "Rodzice",
        "active_nav": "rodzice",
    }),
    ("pielegnarka.html", "pielegnarka.html", {
        "breadcrumb_section": "Rodzice",
        "active_nav": "rodzice",
    }),
    ("standardy-ochrony-maloletnich.html", "standardy-ochrony-maloletnich.html", {
        "breadcrumb_section": "",
        "active_nav": "rodzice",
    }),
    ("rekrutacja.html", "rekrutacja.html", {
        "breadcrumb_section": "Rodzice",
        "active_nav": "rodzice",
    }),
    ("kalendarz.html", "kalendarz.html", {
        "breadcrumb_section": "Rodzice",
        "active_nav": "rodzice",
    }),
    ("rada-rodzicow.html", "rada-rodzicow.html", {
        "breadcrumb_section": "Rodzice",
        "active_nav": "rodzice",
    }),
    ("dokumenty.html", "dokumenty.html", {
        "breadcrumb_section": "Rodzice",
        "active_nav": "rodzice",
    }),

    # ── Projekty ──────────────────────────────────────────────────────────────
    ("projekty.html", "projekty.html", {
        "breadcrumb_section": "",
        "active_nav": "projekty",
    }),

    # ── Pracownicy ────────────────────────────────────────────────────────────
    ("zfss.html", "zfss.html", {
        "breadcrumb_section": "Dla pracowników",
        "active_nav": "",
    }),

    # ── Inne ──────────────────────────────────────────────────────────────────
    ("deklaracja-dostepnosci.html", "deklaracja-dostepnosci.html", {
        "breadcrumb_section": "",
        "active_nav": "",
    }),
    ("polityka-prywatnosci.html", "polityka-prywatnosci.html", {
        "breadcrumb_section": "",
        "active_nav": "",
    }),
]

# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────
def build_page(template_name, output_name, context):
    template = env.get_template(f"pages/{template_name}")
    rendered = template.render(**context)
    out_path = os.path.join(OUTPUT_DIR, output_name)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(rendered)
    print(f"  ✓ {output_name}")


def main():
    filter_name = sys.argv[1] if len(sys.argv) > 1 else None
    built = 0

    print("SP32 build —", "wszystkie strony" if not filter_name else filter_name)
    for (tname, oname, ctx) in PAGES:
        if filter_name and tname != filter_name and oname != filter_name:
            continue
        try:
            build_page(tname, oname, ctx)
            built += 1
        except Exception as e:
            print(f"  ✗ {tname}: {e}")

    print(f"\nGotowe: {built} stron(y)")


if __name__ == "__main__":
    main()
