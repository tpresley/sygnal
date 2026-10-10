"""The I-2 Helix checks: python3 test.py <work dir> [strict|none|init-flat]

Makes a fresh fixture (../make-fixture.sh) with a project-local .helix/languages.toml (this
directory's languages.toml with the server wrapped in ../lsp-tap.mjs), runs `hx -v` in a pty
(pty_screen.py), drives it with keys and saves, under <work dir>/helix-<mode>/:
  NN-<step>.txt   the screen after each step
  lsp.jsonl       the LSP traffic (lsp-tap.mjs);  helix.log  Helix's own log
  result.json     the checks that can be read from disk or the traffic
Settings modes: strict = config { sygnal = { strict = true } }; init-flat = config { strict = true };
none = no config table.
"""
import json, os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_screen import Pty

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(sys.argv[1])
MODE = sys.argv[2] if len(sys.argv) > 2 else 'strict'
OUT = os.path.join(WORK, f'helix-{MODE}')
PROJ = os.path.join(WORK, f'proj-helix-{MODE}')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
# multi: one Helix workspace holding two projects (a/ and a-b/, each with a package.json)
ROOT = PROJ
if MODE == 'multi':
    shutil.rmtree(ROOT, ignore_errors=True)
    os.makedirs(ROOT)
    PROJ = os.path.join(ROOT, 'a')
subprocess.run(['sh', os.path.join(HERE, '..', 'make-fixture.sh'), PROJ], check=True, stdout=subprocess.DEVNULL)

TAP = os.path.abspath(os.path.join(HERE, '..', 'lsp-tap.mjs'))
LOG = os.path.join(OUT, 'lsp.jsonl')
toml = open(os.path.join(HERE, 'languages.toml')).read()
toml = toml.replace('command = "npx"\nargs = ["--no-install", "sygnal-check", "lsp"]',
                    f'command = "node"\nargs = [{json.dumps(TAP)}, {json.dumps(LOG)}, "npx", "--no-install", "sygnal-check", "lsp"]')
if MODE == 'none':
    toml = toml.replace('config = { sygnal = { strict = true } }\n', '')
elif MODE == 'init-flat':
    toml = toml.replace('config = { sygnal = { strict = true } }', 'config = { strict = true }')
if MODE == 'multi':
    # Helix finds a server's root from the language's `roots` markers, below the workspace
    for lang in ('javascript', 'jsx', 'typescript', 'tsx'):
        toml = toml.replace(f'name = "{lang}"\n', f'name = "{lang}"\nroots = ["package.json"]\n')
os.makedirs(os.path.join(ROOT, '.helix'))
open(os.path.join(ROOT, '.helix', 'languages.toml'), 'w').write(toml)

env = dict(os.environ, TERM='xterm-256color', XDG_CONFIG_HOME=os.path.join(OUT, 'xdg'), COLORTERM='')
first = 'a/src/C.jsx' if MODE == 'multi' else 'src/C.jsx'
t = Pty(['hx', '-v', '--log', os.path.join(OUT, 'helix.log'), first], cwd=ROOT, env=env, rows=45, cols=200)
n = [0]
result = {'mode': MODE, 'steps': []}


def shot(name):
    n[0] += 1
    path = os.path.join(OUT, f'{n[0]:02d}-{name}.txt')
    open(path, 'w').write(t.screen() + '\n')
    return t.screen()


def rec(name, ok, detail=None):
    result['steps'].append({'name': name, 'ok': bool(ok), 'detail': detail})


def disk(rel):
    return open(os.path.join(PROJ, rel)).read()


def esc():
    t.send('\x1b', 0.3)


def goto(line, col):
    """Line and column 1-based: `:N`, then gh and (col-1)l."""
    t.send(f':{line}\r', 0.3)
    t.send('gh', 0.2)
    if col > 1:
        t.send(f'{col - 1}l', 0.3)


if MODE == 'multi':
    t.wait(5)
    shot('open-a-C')
    t.send(':open a-b/src/C.jsx\r', 4.0)
    s = shot('open-a-b-C')
    rec('a second project in the workspace gets findings', '●' in s, None)
    t.send(' D', 1.5)
    shot('workspace-diagnostics')
    esc()
    t.send(':qa!\r', 0.5)
    result['hx_exit'] = t.close(10)
    time.sleep(1.5)
    json.dump(result, open(os.path.join(OUT, 'result.json'), 'w'), indent=1)
    for s in result['steps']:
        print(('  ok   ' if s['ok'] else '  FAIL ') + s['name'])
    print('  hx exit:', result.get('hx_exit'))
    sys.exit(0)

try:
    t.wait(5)
    s = shot('open-C')
    rec('C.jsx opens; gutter/statusline show diagnostics', 'W' in s or '●' in s, None)

    # the cursor on the SYG110 selector: diagnostic under the cursor shows inline, then hover
    goto(5, 56)
    t.wait(0.8)
    shot('cursor-on-SYG110')
    t.send(' k', 1.5)
    s = shot('hover-SYG110')
    rec('hover popup (space k) shows the explanation', 'SYG110' in s and 'Fix:' in s, None)
    esc()

    # the buffer diagnostics picker
    t.send(' d', 1.5)
    s = shot('diagnostics-picker')
    rec('diagnostics picker (space d) lists the findings', 'SYG101' in s and 'SYG110' in s and 'SYG102' in s, None)
    esc()

    # code actions at SYG110: the menu, then the first entry, then save
    goto(5, 56)
    t.send(' a', 2.0)
    s = shot('code-actions-SYG110')
    rec('code action menu (space a) at SYG110', "Change '.incc' to '.inc'" in s, None)
    t.send('\r', 1.0)
    t.send(':w\r', 2.0)
    shot('after-quick-fix')
    line5 = disk('src/C.jsx').split('\n')[4]
    rec('the first menu entry (the quick fix) applies', "'.inc'" in line5, line5)

    # suppress SYG102 on line 6: open the menu, move to the Suppress entry
    goto(6, 20)
    t.send(' a', 2.0)
    s = shot('code-actions-SYG102')
    entries = [l for l in s.split('\n') if 'SYG102' in l or 'Remove the unreachable' in l or 'Suppress' in l]
    lines = [l.strip() for l in s.split('\n')]
    idx = None
    menu = [l for l in lines if 'Remove the unreachable' in l or l.startswith('Suppress') or 'Suppress SYG' in l]
    for k, l in enumerate(menu):
        if 'Suppress SYG102' in l:
            idx = k
    if idx is not None:
        for _ in range(idx):
            t.send('\x1b[B', 0.2)  # down
        t.send('\r', 1.0)
        t.send(':w\r', 2.0)
    shot('after-suppress')
    c = disk('src/C.jsx').split('\n')
    rec('the suppress entry applies', any('sygnal-ignore-next-line SYG102' in l for l in c), {'menu': menu, 'file': c[3:8]})

    # the workspace diagnostics picker: unopened files' findings (E.jsx: SYG505 only with strict)
    t.send(' D', 1.5)
    s = shot('workspace-diagnostics')
    rec(f'workspace picker (space D): SYG505 on E.jsx {"present" if "SYG505" in s else "absent"} (strict expected: {MODE != "none"})',
        ('SYG505' in s) == (MODE != 'none'), None)
    esc()

    # relatedInformation: E.jsx's SYG105 on line 7
    t.send(':open src/E.jsx\r', 2.5)
    goto(7, 29)
    t.wait(0.8)
    shot('E-cursor-on-SYG105')
    t.send(' k', 1.5)
    shot('E-hover-SYG105')
    esc()

    # a file written on disk while Helix runs (watched files?)
    open(os.path.join(PROJ, 'src', 'D.jsx'), 'w').write(
        "function D() { return <div className=\"a\" /> }\nD.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\nD.model = { GO: (s) => s }\nexport default D\n")
    t.wait(3)
    # a second root: open a file of the -b copy (didChangeWorkspaceFolders?)
    t.send(f':open {PROJ}-b/src/C.jsx\r', 3.0)
    shot('open-B-C')
    t.send(' D', 1.5)
    shot('workspace-diagnostics-after')
    esc()

    # quit
    t.send(':qa!\r', 0.5)
    result['hx_exit'] = t.close(10)
except Exception as e:  # keep what we have
    import traceback
    rec('error', False, traceback.format_exc())
    t.close(2)

time.sleep(1.5)
json.dump(result, open(os.path.join(OUT, 'result.json'), 'w'), indent=1)
for s in result['steps']:
    print(('  ok   ' if s['ok'] else '  FAIL ') + s['name'])
print('  hx exit:', result.get('hx_exit'))
