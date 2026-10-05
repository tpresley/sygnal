"""Presentation sheet (index.html) for the final logo set."""
import base64
import os


def write(d):
    r = lambda n: open(os.path.join(d, n)).read()
    b64 = lambda n: "data:image/png;base64," + base64.b64encode(open(os.path.join(d, n), "rb").read()).decode()
    sw = lambda hexv, name, use: f'<div class="sw"><span style="background:{hexv}"></span><b>{hexv}</b><small>{name}<br>{use}</small></div>'
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sygnal Logo Final</title>
<style>
:root{{--bg:#f6f8fb;--fg:#0e1726;--muted:#5b6678;--card:#fff;--line:#e3e8ef;--night:#0b1220}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#0a0f19;--fg:#e8eef7;--muted:#97a3b6;--card:#121a28;--line:#223047}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,sans-serif;padding:32px 16px}}
main{{max-width:1040px;margin:0 auto}}h1{{font-size:26px;margin:0 0 4px}}h2{{font-size:18px;margin:36px 0 12px}}.sub{{color:var(--muted);margin:0 0 20px}}
.hero{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.panel{{border-radius:12px;display:grid;place-items:center;padding:48px 32px}}.panel svg{{width:100%;max-width:360px;height:auto;display:block}}
.light{{background:#fff;border:1px solid var(--line)}}.dark{{background:var(--night)}}.blue{{background:#1485EF}}
.grid5{{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}}.grid4{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}
.tile{{aspect-ratio:1;border-radius:10px;display:grid;place-items:center;padding:22%}}.tile svg{{width:100%;height:100%}}
.lk{{border-radius:10px;display:grid;place-items:center;padding:28px 22px}}.lk svg{{width:100%;height:auto;max-width:220px}}
figure{{margin:0}}figcaption{{font-size:12px;color:var(--muted);margin-top:6px;text-align:center}}
.icons{{display:flex;gap:28px;align-items:flex-end;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}}
.icons img{{display:block;image-rendering:auto}}.icons figure{{text-align:center}}
.tab{{display:flex;align-items:center;gap:8px;background:#dfe5ee;border-radius:8px 8px 0 0;padding:8px 14px;font-size:13px;color:#1a2433;width:220px}}
.specs{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}}
.card h3{{margin:0 0 10px;font-size:15px}}.card dl{{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0;font-size:14px}}.card dt{{color:var(--muted)}}.card dd{{margin:0}}
.sws{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}}.sw span{{display:block;height:44px;border-radius:8px;border:1px solid var(--line);margin-bottom:6px}}.sw b{{display:block;font:600 13px ui-monospace,monospace}}.sw small{{color:var(--muted);font-size:12px;line-height:1.35;display:block}}
code{{font:13px ui-monospace,monospace}}ul.files{{columns:2;font-size:13px;margin:0;padding-left:18px}}
@media (max-width:760px){{.hero,.specs{{grid-template-columns:1fr}}.grid5,.grid4{{grid-template-columns:repeat(2,1fr)}}ul.files{{columns:1}}.sws{{grid-template-columns:repeat(2,1fr)}}}}
</style></head><body><main>
<h1>Sygnal logo · final</h1>
<p class="sub">Mark A (Square Duo) with the wordmark in Red Hat Display SemiBold, lowercase. The wordmark is outlined, so no font is needed to display it.</p>
<div class="hero"><div class="panel light">{r("sygnal-logo.svg")}</div><div class="panel dark">{r("sygnal-logo-on-dark.svg")}</div></div>

<h2>Mark</h2>
<div class="grid5">
<figure><div class="tile light">{r("sygnal-mark.svg")}</div><figcaption>Primary</figcaption></figure>
<figure><div class="tile dark">{r("sygnal-mark-on-dark.svg")}</div><figcaption>On dark</figcaption></figure>
<figure><div class="tile light">{r("sygnal-mark-blue.svg")}</div><figcaption>Single colour</figcaption></figure>
<figure><div class="tile light">{r("sygnal-mark-black.svg")}</div><figcaption>Black</figcaption></figure>
<figure><div class="tile blue">{r("sygnal-mark-white.svg")}</div><figcaption>White (reversed)</figcaption></figure>
</div>

<h2>Logo</h2>
<div class="grid4">
<figure><div class="lk light">{r("sygnal-logo.svg")}</div><figcaption>Primary</figcaption></figure>
<figure><div class="lk dark">{r("sygnal-logo-on-dark.svg")}</div><figcaption>On dark</figcaption></figure>
<figure><div class="lk light">{r("sygnal-logo-black.svg")}</div><figcaption>Black</figcaption></figure>
<figure><div class="lk blue">{r("sygnal-logo-white.svg")}</div><figcaption>White (reversed)</figcaption></figure>
</div>

<h2>Icons</h2>
<div class="icons">
<figure><div class="tab"><img src="{b64("favicon-16.png")}" width="16" height="16" alt="">Sygnal · Docs</div><figcaption>Browser tab, 16 px</figcaption></figure>
<figure><img src="{b64("favicon-16.png")}" width="16" height="16" alt=""><figcaption>16</figcaption></figure>
<figure><img src="{b64("favicon-32.png")}" width="32" height="32" alt=""><figcaption>32</figcaption></figure>
<figure><img src="{b64("favicon-48.png")}" width="48" height="48" alt=""><figcaption>48</figcaption></figure>
<figure><img src="{b64("apple-touch-icon.png")}" width="90" height="90" alt="" style="border-radius:20px;box-shadow:0 1px 4px rgba(0,0,0,.18)"><figcaption>Apple touch (180)</figcaption></figure>
<figure><img src="{b64("icon-512.png")}" width="128" height="128" alt="" style="border-radius:28px;box-shadow:0 1px 4px rgba(0,0,0,.18)"><figcaption>PWA icon (192 / 512)</figcaption></figure>
</div>

<h2>Specification</h2>
<div class="specs">
<div class="card"><h3>Colour</h3><div class="sws">
{sw("#1485EF","Sygnal Blue","Upper chevron; single-colour mark")}
{sw("#0B5CC4","Deep Blue","Lower chevron")}
{sw("#0E1726","Ink","Wordmark on light; black version")}
{sw("#4AA8FF","Sky","Upper chevron on dark")}
{sw("#1485EF","Sygnal Blue","Lower chevron on dark")}
{sw("#F2F6FC","Paper","Wordmark on dark")}
</div></div>
<div class="card"><h3>Construction</h3><dl>
<dt>Grid</dt><dd>200 × 200 units, slopes 2:1 (26.57°)</dd>
<dt>Stroke</dt><dd>38 units (vertical), legs and middle arms</dd>
<dt>Slits</dt><dd>9 units, perpendicular</dd>
<dt>Turns</dt><dd>Vertical edges; flat horizontal ends</dd>
<dt>Symmetry</dt><dd>Lower chevron is the upper rotated 180°</dd>
</dl></div>
<div class="card"><h3>Wordmark</h3><dl>
<dt>Typeface</dt><dd>Red Hat Display SemiBold (600), SIL OFL</dd>
<dt>Setting</dt><dd>Lowercase, tracking −0.02 em, kerning on; “s” enlarged 3% (optical correction)</dd>
<dt>Mark size</dt><dd>96% of the wordmark's full height (top of “l” to bottom of “y”), centred on it</dd>
<dt>Gap</dt><dd>0.37 em between mark and “s”</dd>
</dl></div>
<div class="card"><h3>Usage</h3><dl>
<dt>Clear space</dt><dd>At least ¼ of the mark's height on all sides</dd>
<dt>Minimum size</dt><dd>Mark 16 px; full logo 80 px wide</dd>
<dt>Favicon</dt><dd><code>favicon.svg</code> switches to the on-dark colours under <code>prefers-color-scheme: dark</code></dd>
</dl></div>
</div>

<h2>Files</h2>
<div class="card"><ul class="files">
<li><code>sygnal-logo.svg</code>, <code>-on-dark</code>, <code>-black</code>, <code>-white</code></li>
<li><code>sygnal-mark.svg</code>, <code>-on-dark</code>, <code>-blue</code>, <code>-black</code>, <code>-white</code></li>
<li><code>favicon.svg</code> (adapts to dark mode)</li>
<li><code>favicon-16/32/48.png</code></li>
<li><code>apple-touch-icon.png</code> (180)</li>
<li><code>icon-192.png</code>, <code>icon-512.png</code></li>
<li><code>icon-192.svg</code>, <code>icon-512.svg</code> (dark tile, create-sygnal-app PWA templates)</li>
<li><code>devtools-icon16/32/48/128.png</code> (browser extension)</li>
<li><code>source/</code>: the generator; see <code>source/README.md</code></li>
</ul></div>
</main></body></html>'''
    open(os.path.join(d, "index.html"), "w").write(html)
