# Sygnal logo source

Generates every logo asset in `design/logo-final/` from code: the mark geometry, the outlined wordmark, the icons and the presentation sheet (`index.html`).

- `mark.py`: geometry of the mark (two nested chevrons on a 2:1 slope, 200-unit grid)
- `build.py`: palette, wordmark settings, lockup layout and every output file; `--install` copies the assets into the repo
- `sheet.py`: the presentation sheet

## Setup

The wordmark is Red Hat Display (SIL Open Font License). The font is not committed; download the variable font into `fonts/` (git-ignored):

```bash
mkdir -p design/logo-final/source/fonts
```

```bash
curl -L -o "design/logo-final/source/fonts/RedHatDisplay[wght].ttf" "https://github.com/google/fonts/raw/main/ofl/redhatdisplay/RedHatDisplay%5Bwght%5D.ttf"
```

```bash
python3 -m venv design/logo-final/source/.venv
```

```bash
design/logo-final/source/.venv/bin/pip install -r design/logo-final/source/requirements.txt
```

## Build

```bash
design/logo-final/source/.venv/bin/python design/logo-final/source/build.py
```

Add `--install` to also copy the assets to the places the repo uses them: the docs site, every `create-sygnal-app` template (`favicon.svg`, `logo.svg`, PWA icons), the todomvc example and the devtools extension icons.

## Tuning

- Mark proportions: `mark(tl=38, tm=38, g=9)` in `build.py`. `tl` is leg thickness, `tm` middle-arm thickness, `g` slit width.
- Lockup: `S_SCALE` (optical size correction for the "s", 3%), `MARK_SCALE` (mark at 96% of the wordmark's ink height), `GAP`, `TRACK`.
- Colours: the palette block at the top of `build.py`.
