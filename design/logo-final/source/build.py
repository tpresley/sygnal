#!/usr/bin/env python3
"""Build every Sygnal logo asset from source.

    python design/logo-final/source/build.py             # write design/logo-final/*
    python design/logo-final/source/build.py --install   # ...and copy into the repo

Needs Red Hat Display (variable, SIL OFL) at
design/logo-final/source/fonts/RedHatDisplay[wght].ttf. See README.md.
"""
import argparse
import io
import os
import shutil

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw
from shapely import affinity
from shapely.ops import unary_union

from mark import mark, path_d, polys
import sheet

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(SRC)                       # design/logo-final
ROOT = os.path.abspath(os.path.join(OUT, "..", ".."))
FONT = os.path.join(SRC, "fonts", "RedHatDisplay[wght].ttf")

# ---- palette -------------------------------------------------------------------
UP, LO = "#1485EF", "#0B5CC4"            # mark on light backgrounds
UP_D, LO_D = "#4AA8FF", "#1485EF"        # mark on dark backgrounds
INK, INK_D = "#0E1726", "#F2F6FC"        # wordmark
BLACK, WHITE = "#0E1726", "#FFFFFF"
TILE = "#0f1117"                         # background of the template PWA icons

# ---- wordmark settings ----------------------------------------------------------
WEIGHT = 600
TRACK = -20          # -0.02em at 1000 upm
S_SCALE = 1.03       # optical correction: next to the big S mark the "s" reads small
MARK_SCALE = 0.96    # mark height as a share of the wordmark's ink height
GAP = 370            # font units between mark and "s"

# ---- mark -------------------------------------------------------------------------
U, L = mark(tl=38, tm=38, g=9)
mx0, my0, mx1, my1 = unary_union([U, L]).bounds


def scaled(geom, s, dx, dy):
    return affinity.translate(affinity.scale(geom, s, s, origin=(0, 0)), dx, dy)


# ---- wordmark: shaped with HarfBuzz, outlined ------------------------------------
def load_font():
    if not os.path.exists(FONT):
        raise SystemExit(f"Missing font: {FONT}\nSee design/logo-final/source/README.md")
    inst = instancer.instantiateVariableFont(TTFont(FONT), {"wght": WEIGHT})
    data = io.BytesIO()
    inst.save(data)
    return TTFont(io.BytesIO(data.getvalue())), data.getvalue()


tt, font_bytes = load_font()
gs = tt.getGlyphSet()
order = tt.getGlyphOrder()
half_x = tt["OS/2"].sxHeight / 2

buf = hb.Buffer()
buf.add_str("sygnal")
buf.guess_segment_properties()
hb.shape(hb.Font(hb.Face(hb.Blob(font_bytes))), buf, {"kern": True, "liga": True})

word = RecordingPen()
x = 0
for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
    sc = S_SCALE if i == 0 else 1.0
    # font units are y-up; flip to SVG y-down. The "s" is scaled about the middle
    # of the x-height band so it grows evenly above and below.
    gs[order[info.codepoint]].draw(
        TransformPen(word, (sc, 0, 0, -sc, x + pos.x_offset, -pos.y_offset + half_x * (sc - 1))))
    x += pos.x_advance * sc + TRACK
bp = BoundsPen(gs)
word.replay(bp)
tx0, ty0, tx1, ty1 = bp.bounds           # ink bounds, y-down


def word_path(dx, dy):
    sp = SVGPathPen(gs)
    word.replay(TransformPen(sp, (1, 0, 0, 1, dx, dy)))
    return sp.getCommands()


# ---- lockup layout (font units, baseline at y=0) ----------------------------------
# The mark is MARK_SCALE of the wordmark's ink height (top of "l" to bottom of
# "y"/"g"), centred on it.
mh = (ty1 - ty0) * MARK_SCALE
ms = mh / (my1 - my0)
m_dx = -mx0 * ms
m_dy = (ty0 + ty1) / 2 - mh / 2 - my0 * ms
mark_w = (mx1 - mx0) * ms
w_dx = mark_w + GAP - tx0
LOCK = (0, ty0, mark_w + GAP + (tx1 - tx0), ty1)


def square_box():
    w, h = mx1 - mx0, my1 - my0
    side = max(w, h)
    return mx0 - (side - w) / 2, my0 - (side - h) / 2, side


def mark_svg(up, lo):
    x0, y0, side = square_box()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.2f} {y0:.2f} {side:.2f} {side:.2f}" '
            f'role="img" aria-label="Sygnal"><path fill="{up}" d="{path_d(U)}"/><path fill="{lo}" d="{path_d(L)}"/></svg>\n')


def lockup_svg(up, lo, ink):
    Um, Lm = scaled(U, ms, m_dx, m_dy), scaled(L, ms, m_dx, m_dy)
    x0, y0, x1, y1 = LOCK
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.1f} {y0:.1f} {x1 - x0:.1f} {y1 - y0:.1f}" '
            f'role="img" aria-label="sygnal"><path fill="{up}" d="{path_d(Um)}"/><path fill="{lo}" d="{path_d(Lm)}"/>'
            f'<path fill="{ink}" d="{word_path(w_dx, 0)}"/></svg>\n')


def favicon_svg():
    x0, y0, side = square_box()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.2f} {y0:.2f} {side:.2f} {side:.2f}">'
            f'<style>.u{{fill:{UP}}}.l{{fill:{LO}}}@media (prefers-color-scheme:dark){{.u{{fill:{UP_D}}}.l{{fill:{LO_D}}}}}</style>'
            f'<path class="u" d="{path_d(U)}"/><path class="l" d="{path_d(L)}"/></svg>\n')


def tile_icon_svg(size, rx_ratio=0.125, pad=0.2):
    """Dark rounded tile used by the create-sygnal-app PWA templates."""
    w, h = mx1 - mx0, my1 - my0
    inner = size * (1 - 2 * pad)
    k = inner / max(w, h)
    dx = size * pad + (inner - w * k) / 2 - mx0 * k
    dy = size * pad + (inner - h * k) / 2 - my0 * k
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            f'<rect width="{size}" height="{size}" rx="{size * rx_ratio:.0f}" fill="{TILE}"/>'
            f'<path fill="{UP_D}" d="{path_d(scaled(U, k, dx, dy))}"/><path fill="{LO_D}" d="{path_d(scaled(L, k, dx, dy))}"/></svg>\n')


def png(size, path, pad=0.0, bg=None):
    """Rasterise the polygons directly, 8x supersampled."""
    S = size * 8
    im = Image.new("RGBA", (S, S), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w, h = mx1 - mx0, my1 - my0
    inner = S * (1 - 2 * pad)
    k = inner / max(w, h)
    ox = S * pad + (inner - w * k) / 2 - mx0 * k
    oy = S * pad + (inner - h * k) / 2 - my0 * k
    for geom, col in ((U, UP), (L, LO)):
        for p in polys(geom):
            d.polygon([(ox + x * k, oy + y * k) for x, y in p.exterior.coords], fill=col)
    im.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, path))


def build():
    files = {
        "sygnal-mark.svg": mark_svg(UP, LO),
        "sygnal-mark-on-dark.svg": mark_svg(UP_D, LO_D),
        "sygnal-mark-blue.svg": mark_svg(UP, UP),
        "sygnal-mark-black.svg": mark_svg(BLACK, BLACK),
        "sygnal-mark-white.svg": mark_svg(WHITE, WHITE),
        "sygnal-logo.svg": lockup_svg(UP, LO, INK),
        "sygnal-logo-on-dark.svg": lockup_svg(UP_D, LO_D, INK_D),
        "sygnal-logo-black.svg": lockup_svg(BLACK, BLACK, BLACK),
        "sygnal-logo-white.svg": lockup_svg(WHITE, WHITE, WHITE),
        "favicon.svg": favicon_svg(),
        "icon-192.svg": tile_icon_svg(192),
        "icon-512.svg": tile_icon_svg(512),
    }
    for name, content in files.items():
        with open(os.path.join(OUT, name), "w") as f:
            f.write(content)
    png(16, "favicon-16.png")
    png(32, "favicon-32.png")
    png(48, "favicon-48.png")
    png(180, "apple-touch-icon.png", pad=0.16, bg="#FFFFFF")
    png(192, "icon-192.png", pad=0.14, bg="#FFFFFF")
    png(512, "icon-512.png", pad=0.14, bg="#FFFFFF")
    # Chrome extension icons: transparent; 128 uses the recommended 16px inset.
    for size, pad in ((16, 0.0), (32, 0.03), (48, 0.04), (128, 0.125)):
        png(size, f"devtools-icon{size}.png", pad=pad)
    sheet.write(OUT)


def install():
    """Copy the built assets to every place the repo uses the logo."""
    templates = sorted(d for d in os.listdir(os.path.join(ROOT, "create-sygnal-app"))
                       if d.startswith("template-"))
    copies = [
        ("favicon.svg", "docs/public/favicon.svg"),
        ("sygnal-logo.svg", "docs/src/assets/sygnal-logo.svg"),
        ("sygnal-logo-on-dark.svg", "docs/src/assets/sygnal-logo-light.svg"),  # dark theme
        ("favicon.svg", "examples/todomvc/favicon.svg"),
    ]
    for t in templates:
        base = f"create-sygnal-app/{t}/public"
        copies += [("favicon.svg", f"{base}/favicon.svg"),
                   ("sygnal-mark-on-dark.svg", f"{base}/logo.svg")]   # templates are dark-themed
        if "pwa" in t:
            copies += [("icon-192.svg", f"{base}/icon-192.svg"), ("icon-512.svg", f"{base}/icon-512.svg")]
    for size in (16, 32, 48, 128):
        for d in ("devtools", "dist-devtools"):
            copies.append((f"devtools-icon{size}.png", f"{d}/icons/icon{size}.png"))
    for src, dst in copies:
        shutil.copyfile(os.path.join(OUT, src), os.path.join(ROOT, dst))
    print(f"installed {len(copies)} files")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--install", action="store_true", help="also copy the assets into the repo")
    args = ap.parse_args()
    build()
    print(f"built assets in {os.path.relpath(OUT, ROOT)}")
    if args.install:
        install()
