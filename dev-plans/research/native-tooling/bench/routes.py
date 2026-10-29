# End-to-end wall time (process included) of each route on one input, interleaved, median of N.
#   python3 routes.py <scratch> <dir> [runs=5]   (scratch: the npm dir with oxc-parser and oxlint)
import subprocess, time, sys, os, statistics
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.abspath(os.path.join(here, '../../../..'))
scr, d = sys.argv[1], sys.argv[2]; runs = int(sys.argv[3]) if len(sys.argv) > 3 else 5
native = os.path.join(here, '../native-go/bin/sygnal-native')
routes = {
  'sygnal-check (all rules)': ['node', f'{root}/sygnal-check/bin/sygnal-check.js', d, '--json', '--fail-on=never'],
  'sygnal-check (default rules)': ['node', f'{here}/../lite/run-sygnal-check.mjs', d],
  'lite JS on oxc-parser': ['node', f'{here}/../lite/run-oxc.mjs', f'{scr}/npm', d],
  'oxlint + JS plugin (3 rules)': [f'{scr}/npm/node_modules/.bin/oxlint', '-c', f'{here}/../oxlint-plugin/.oxlintrc.json', d],
}
if os.path.exists(native): routes['native Go (4 rules, all cores)'] = [native, d]
res = {k: [] for k in routes}
for r in range(runs):
  for k, c in routes.items():
    t = time.perf_counter(); subprocess.run(c, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); res[k].append((time.perf_counter() - t) * 1000)
print(os.path.basename(d.rstrip('/')))
for k, v in res.items(): print(f'  {k:30} {statistics.median(v):7.0f} ms (min {min(v):.0f})')
