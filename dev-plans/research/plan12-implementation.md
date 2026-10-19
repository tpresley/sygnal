# PLAN-12 implementation verification

The user reviewed the two spike reports before authorizing production work. This record covers
R/C/B-2/T in the shared checkout. Research candidates retain their original measurements and
limitations; they are not the production implementation.

## Commands and results

| Gate | Result |
|---|---|
| All 24 existing Rollup configurations, declaration bundle, shipped guide copy | Pass via isolated configuration processes; see build limitation below |
| `npm_config_cache=/private/tmp/sygnal-p11-npm-cache npx vitest run --maxWorkers=4` | 449 files / 5,024 tests pass; 6 files / 33 tests skipped |
| `npm run test:examples` | All 14 example suites pass |
| `npm run test:types` | Source and strict public type fixtures pass |
| `npm --prefix sygnal-check test` | 75 files / 1,555 tests pass; 1 file / 4 tests skipped |
| `npm run test:browser` | 377/377 core cases pass; WebMCP native/absent/polyfill and all graph-page suites pass |
| `node scripts/perf-gate.mjs` | All count/retention/heap gates pass; settled heap delta 0.91 MB, limit 1.00 MB |
| `node scripts/size-gate.mjs` | 42,758 B gzip / approved 42,800 B budget; 42 B headroom |
| `node scripts/check-doc-samples.mjs` | 847 clean, 26 marker-skipped; zero strict/a11y/pattern/parser findings |
| `npm --prefix docs run build` | 111 pages, 112-page link check clean, code-title check clean |
| `BROWSER=chromium\|firefox\|webkit npm --prefix docs run check-live` (one run per engine) | All 117 demos pass in each engine |
| Skill creator `quick_validate.py skills/sygnal-dev` | Valid |
| `git diff --check`; root/public llms byte comparison | Clean / identical |

The packed create-sygnal-app CLI was also exercised in a fresh directory containing `.git`,
with `.` as its destination and `--template vite --ts --no-install`. Using the locally installed
matching toolchain and this checkout's Sygnal/checker, its generated test suite, strict checker,
TypeScript check and production Vite build all pass. No registry installation was performed.
Permanent CLI tests cover `.git` files/directories, `.DS_Store`, preservation, rejected content,
and every scaffold variant's strict source check.

## Coverage and contracts

Permanent timing cases cover app/component/behavior combinations, mixed output provenance,
STATE/HOST composition, abort/same/throw/no-STATE cases, calculated state and context,
previousState, app isolation, synchronous replies, effect exception order and disposal signal,
renderComponent, invalid declarations, parent independence, HMR and transformed PERSIST sinks.
Type fixtures check mode rejection, previousState typing, generic queries and typed controls.

The binding suite verifies retained-target warnings, equivalent byId metadata, custom-lens
exclusions, explicit remounts and a keyed master-detail flow. That flow switches and creates
projects, applies a fake AI result, edits nested Collections, persists/reloads and verifies the
unselected record remains unchanged. Automatic rebinding remains excluded for the lifetime
reasons demonstrated in the [spike report](state-rebinding/README.md).

## Size decision

Same-toolchain research baseline: 42,495 B. Final production: 42,758 B (**+263 B**).
The implementation compiles/caches schedules per normalized definition and effective mode,
keeps plain legacy actions on the existing array, and tree-shakes behavior composition when
unused. Optimization reduced the initial production candidate from about 42,880 B to 42,758 B.
The user explicitly approved **42,800 B** after being told the optimized result was 58 B above
the old limit. The size script was changed only after that approval. Default native-globalThis
production bundle: **38,741 B**. Core-only informational measurement: 49,858 B min / 18,566 B gzip.

## Build limitation

The ordinary all-config Rollup command exhausted Node's default heap; with an 8 GB heap it
emitted the outputs but did not terminate. Verification instead imported the unchanged Rollup
configuration, executed each of its 24 entries in a fresh Node process, wrote all configured
outputs, closed the bundle and exited. The regular declaration build and guide-copy script ran
afterward. No configuration, build budget or test was weakened to conceal this limitation.
The standard `npm run build` process-lifetime/memory issue remains a separate tooling follow-up.

Browser/local-server and watcher tests required execution outside the restricted sandbox;
sandbox EPERM server failures were rerun with those permissions, not counted as passing.

No package versions were bumped and nothing was published. At release, publish the runtime and
checker before the after-mode starters, and set their minimum dependency versions accordingly.
