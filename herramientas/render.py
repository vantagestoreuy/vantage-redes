#!/usr/bin/env python3
"""Exporta artboards .dc.html (lienzo Design de Vantage UY) a PNG.

Uso:
  python3 render.py PIEZA.dc.html SALIDA.png --assets DIR_ASSETS --fonts DIR_FONTS [--w 1080 --h 1350]

- DIR_ASSETS: carpeta con las imágenes descargadas; cada archivo empieza con el id del asset
  (ej. 27b82d1adeafa9832888eec247fd6c8c.png). Las referencias /_blob/<id> se reemplazan por esos archivos.
- DIR_FONTS: node_modules/@fontsource (npm i @fontsource/montserrat @fontsource/barlow-condensed).
- Las piezas deben ser markup estático (sin {{holes}}, sin <sc-for>/<sc-if>).
"""
import argparse, glob, os, re, sys, pathlib
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("out")
ap.add_argument("--assets", required=True); ap.add_argument("--fonts", required=True)
ap.add_argument("--w", type=int, default=1080); ap.add_argument("--h", type=int, default=1350)
a = ap.parse_args()

html = open(a.src, encoding="utf-8").read()
m = re.search(r"<x-dc>(.*)</x-dc>", html, re.S)
if not m:
    sys.exit("No encontré <x-dc> en " + a.src)
body = re.sub(r"<helmet>.*?</helmet>", "", m.group(1), flags=re.S)
if "{{" in body or "<sc-" in body:
    sys.exit("La pieza tiene holes o control de flujo; render.py solo exporta markup estático")

def blob(mt):
    hits = glob.glob(os.path.join(a.assets, mt.group(1) + "*"))
    if not hits:
        sys.exit("Falta el asset " + mt.group(1) + " en " + a.assets)
    return pathlib.Path(hits[0]).resolve().as_uri()
body = re.sub(r"/_blob/([0-9a-f]{32})", blob, body)

F = pathlib.Path(a.fonts)
faces = []
for fam, pkg, weights in [("Montserrat", "montserrat", (600, 800, 900)),
                          ("Barlow Condensed", "barlow-condensed", (500, 600, 700))]:
    for wgt in weights:
        f = F / pkg / "files" / f"{pkg}-latin-{wgt}-normal.woff2"
        if f.exists():
            faces.append(f"@font-face{{font-family:'{fam}';font-weight:{wgt};src:url('{f.resolve().as_uri()}') format('woff2')}}")
page_html = f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>{''.join(faces)} html,body{{margin:0;padding:0;background:transparent}}</style></head>
<body><div id="root" style="width:{a.w}px;height:{a.h}px;overflow:hidden">{body}</div></body></html>"""
tmp = pathlib.Path(a.out).with_suffix(".render.html")
tmp.write_text(page_html, encoding="utf-8")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": a.w, "height": a.h}, device_scale_factor=1)
    pg.goto(tmp.resolve().as_uri())
    pg.wait_for_load_state("networkidle")
    pg.evaluate("document.fonts.ready")
    # chequeo de desborde: ningún elemento debe salir del cuadro
    over = pg.evaluate(f"""() => [...document.querySelectorAll('#root *')].filter(e => {{
        const r = e.getBoundingClientRect(); return r.width>0 && (r.bottom > {a.h}+1 || r.right > {a.w}+1) && getComputedStyle(e).position!=='absolute';
    }}).map(e => (e.textContent||e.tagName).trim().slice(0,40))""")
    if a.out.lower().endswith((".jpg", ".jpeg")):
        pg.locator("#root").screenshot(path=a.out, type="jpeg", quality=92)  # Instagram solo acepta JPEG
    else:
        pg.locator("#root").screenshot(path=a.out)
    b.close()
tmp.unlink()
if over:
    print("AVISO_DESBORDE:", over[:5])
print("OK", a.out)
