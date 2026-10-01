# Skill variants for E5 (skill size and shape)

PLAN-2 experiment E5 (`dev-plans/PLAN-2.md` §5, finding F7). Hypothesis: a shorter `SKILL.md`, holding the workflow, the canonical examples, the testing recipe and a pointer to `llms.txt` for every other API fact, cuts peak context and skill-load time without raising learn or debug time.

Each directory here is a complete `sygnal-dev` skill (same `name` and `description` as `skills/sygnal-dev/SKILL.md`). Neither one ships `references/component-patterns.md` or `agents/`. The skill in `skills/sygnal-dev/` is not changed by this experiment.

| Variant | Directory | Lines | Bytes | vs current (bytes) |
|---|---|---|---|---|
| current | `skills/sygnal-dev/SKILL.md` | 356 | 25,785 | — |
| current, as in v2-baseline (5.4.0) | (released skill) | 327 | 22,485 | 87% |
| lean | `lean/SKILL.md` | 172 | 11,865 | 46% |
| lean-routed | `lean-routed/SKILL.md` | 189 | 13,796 | 54% |

The current skill also ships `references/component-patterns.md` (433 lines, 14,995 bytes). In v2-baseline it was read in 0 of 85 trials.

## What the variants are

**lean.** The sections that trials used, plus the facts they went into `node_modules` to find:
- the workflow and debugging loop (shortened);
- the component anatomy, with a controlled input and `ABORT` folded into the Counter example;
- one example that covers EVENTS, child → parent and Collection, and one async-driver example (component plus `main.js`);
- the extract-a-component recipe in prose; the wiring rules; the canonical-forms table; the `renderComponent` testing recipe;
- a section index for `node_modules/sygnal/llms.txt`, with heading-anchored `sed` ranges, and an explicit "don't search `dist/`".

New facts, each one answering a question that sent baseline trials into `dist/` or into greps of `llms.txt` (evidence below):
- `next()` dispatches `delayMs` after the call, whenever it is called, including later from a callback;
- Collection keys (by `.id`, else by index), the sort forms, that sorting never reorders the state array, that item edits are written back by key, and that the items render inside one `<div>` whose class `className` sets;
- a component adds no wrapper element and no attributes, so moved markup keeps the HTML identical.

Cut from the current skill, and where each item now lives:

| Cut | Baseline evidence (85 Sygnal trials, final code) | Now |
|---|---|---|
| Commands example (`createCommand`) | 0/85 solutions use it | llms.txt §3 |
| `set` / `toggle` | 0/85 | llms.txt §3 (first example) |
| xstream list and the RxJS → xstream table | `sampleCombine` 0/85, `xs.` 5/85, `debounce` 9/85 (task 11 only) | llms.txt §4 |
| Latest-response-only code block | tasks 11 and 17 only | 2-line summary + llms.txt §3, last paragraph |
| Full-app jsdom test | written in 22/85 trials, but llms.txt §7 has the same snippet | pointer to llms.txt §7 |
| simulateEvent selector grammar, `next`/`waitForState`/`settle` timing notes | `waitForState` 1/85, `simulateAction`/`sinkValues`/`emitted` 0/85 | 1-line summary + llms.txt §7 |
| Diagnostics and tools (Vite plugin modes, runtime strict, MCP, `--graph`) | `explain` 0, `--graph` 0, `t.inspect` 1 (85 trials; `sygnal-check` itself ran in 65) | 2 lines in §1 + llms.txt §6 |
| Project setup (Vite) | every task starts from an existing app | none (the template covers it) |
| `references/component-patterns.md` pointer | 0/85 reads | docs API reference |

**lean-routed.** The lean skill plus a "Recipes" table near the top: 11 task types (add state or an action, derived values/context, child → parent and events, Collection, commands, async/drivers, latest-only and debounce, form fields and focus, extract a component, fix a diagnostic, write a test). For each it names the section of this skill, then the exact `sed` range of `llms.txt` and the docs page and anchor to read only if the skill isn't enough. The `sed` ranges are anchored on llms.txt headings (`### Drivers`, `## 4.` …), so they survive line shifts but not renamed headings: re-check them after any llms.txt edit (each range must print 20 to 45 lines).

## Evidence: what baseline trials looked up after loading the skill

From `/private/tmp/sygnal-evals/trials/v2-baseline/sygnal-*.transcript.jsonl` (82 tool calls touching `node_modules/sygnal` in 41 of 85 trials: 49 on `llms.txt` in 41 trials, 32 on `dist/index.*.js` in 13 trials; 156 KB of tool output in total):

| Lookup | Trials | What they wanted | Already in the 5.4.0 skill? |
|---|---|---|---|
| `grep context\|calculated llms.txt` (04, 12) | 7 | context/calculated syntax | yes (§2) |
| `grep -A30 driverFromAsync llms.txt` (05) | 5 | driver wiring (6 KB of output each) | yes (§3) |
| `grep blur\|checked llms.txt` (10) | 4 | focus and checkbox streams | yes (§4) |
| `grep PARENT\|props$ llms.txt` (08) | 3 | child props, PARENT | yes (§4) |
| `grep EFFECT\|next( llms.txt` then `dist/index.esm.js` around `makeEffectHandler` (11, 13, 17) | 11 llms.txt, 7 of them into `dist` | whether `next()` works when called after an `await`, and which state snapshot EFFECT sees | snapshot yes; async `next()` **no** |
| `grep sort llms.txt` then `dist` Collection lens (15) | 5 (all into `dist`) | how a sorted Collection maps item edits back | **no** |
| `grep Collection\|element llms.txt`, `index.d.ts` `CollectionProps` (13) | 4 | whether Collection adds a wrapper element | **no** |
| `grep wrapper\|isolat\|lens llms.txt` (16, 08) | 6 | whether components or isolation change the HTML; lenses | **no** (lens: one phrase) |

Most `llms.txt` greps re-found facts the agent already had in context from SKILL.md: the 22 KB skill was injected whole, and agents still grepped the spec to confirm. The `dist/` reads were for facts neither file had. The lean variants add those facts, cut the rest, and say which `llms.txt` section to print.

All of the added facts were checked against the current build (see "Validation").

## `references/component-patterns.md`: verdict

Drop it from the skill. Read in 0/85 v2-baseline trials (and 0/20 PLAN-1 tier-2 trials). Its 16 topics have full docs pages, and the 0-use features (Portals, Transitions, Slots, refs, Suspense/lazy, drag-and-drop, PWA, SSR, Astro, Vike, TypeScript, `processForm`, BOOTSTRAP/DISPOSE) appear in no task. Candidates to fold into `llms.txt` instead, ranked by transcript evidence (llms.txt is at 249/250 lines, so each one has to replace text):

1. `next()` may be called later, from a callback, and fires `delayMs` after the call (7 trials read `dist`). One clause in §2.
2. Collection: keyed by `.id` (else by index), sort forms (`"field"`, `{ field: 'desc' }`, array, function), the state array is never reordered and edits go back by key, items render inside one `<div>` (`className`). (9 trials: 5 on task 15, 4 on task 13.) It can replace the current §3 Collection bullet.
3. A component adds no wrapper element or attributes (6 trials: all 5 on task 16, 1 on task 08). One clause in §4 "Child props".
4. From component-patterns §2: a 3-line `{ get, set }` lens example (task 16 greps for `lens`). Optional.
5. From component-patterns §1: Switchable pages get `state="key"` slices, so their state survives page switches (task 13's trap). Optional; verify the wording first.

The rest of component-patterns.md should stay out of llms.txt.

## Validation (run on `exp/e5-skill`, current build)

- Strict check of the samples: each variant's ```js/```jsx blocks are written to a directory and checked with `node sygnal-check/bin/sygnal-check.js <dir> --strict --verbose`. Both variants: 5 samples, 0 findings. The checker flags SYG501/502/504 on a deliberately bad file in the same setup. (`scripts/check-doc-samples.mjs` takes no directory argument; add `evals/agent-ergonomics/variants/skills/*/SKILL.md` to its `EXTRA_FILES` if a variant is adopted.)
- Runnable: the samples, assembled into components (`Counter.jsx`, `TaskList.jsx` plus `export default`, `Quote.jsx`, `main.js`) in a scratch Vite + Vitest project using `sygnal/vite` and linked to this checkout's `dist/`:
  - the §6 testing recipe, verbatim: passes;
  - extra tests for the samples and the new facts: Counter controlled input + ABORT; Quote with a test `driverFromAsync` driver, success and `errors()`; an EVENTS payload from a Collection item reaching a non-adjacent component; the Collection `<div class="tasks">` wrapper and no extra attributes (mock DOM and real jsdom); `sort={{ title: 'desc' }}` renders in order, leaves the state array in place and writes an edit back by key; `next()` called 30 ms after an EFFECT returned dispatches; llms.txt §7's jsdom snippet: all 10 pass;
  - `sygnal-check --strict` on the assembled project: 0 findings.

## How to run the eval

The orchestrator uses whatever skill is installed at `~/.claude/skills/sygnal-dev`. Per variant: back up the installed skill, copy the variant's `SKILL.md` there (delete `references/` and `agents/` from the installed copy for the lean variants), run, then restore. The D35 "installed skill differs" warning is expected for the lean variants. The orchestrator's analysis then reads the installed (variant) skill, so the heatmap scores the right sections. To re-analyze later, pass `--skill-dir evals/agent-ergonomics/variants/skills/<variant>`.

```
node evals/agent-ergonomics/orchestrate.mjs --run e5-current --arms sygnal --tasks all --trials 5 --concurrency 4 --model claude-opus-5-5
node evals/agent-ergonomics/orchestrate.mjs --run e5-lean    --arms sygnal --tasks all --trials 5 --concurrency 4 --model claude-opus-5-5
node evals/agent-ergonomics/orchestrate.mjs --run e5-routed  --arms sygnal --tasks all --trials 5 --concurrency 4 --model claude-opus-5-5
```

- **Arms:** Sygnal only. React numbers come from v2-baseline and don't depend on the skill.
- **Current is re-run,** not taken from v2-baseline: the skill grew from 327 to 356 lines in Phase 2 (2-B), and all three runs must use the same tarball and the same model.
- **Tasks:** all tiers, 01–17 (17 tasks × 5 trials = 85 trials per variant, 255 in total; about $97 at the baseline's $0.38 per Sygnal trial). If that is too expensive, screen on 04, 05, 08, 10, 11, 13, 15, 16, 17 (the tasks with `node_modules` lookups) plus 01 and 07 as controls: 11 tasks, 165 trials. Then run the full set only for a variant that clears the decision rule.

## What the analysis should watch

Compare each lean variant with e5-current, task-matched (per-task means, then averaged):

| Metric | Source in `analysis/<run>.md` | Expectation if the hypothesis holds |
|---|---|---|
| Peak context (mean/median) | headline table | drops by roughly the skill-size difference (about 3.5–4k tokens), unless agents read llms.txt sections back in |
| Cache-creation and billed tokens, cost | headline table | drop |
| Learn time by topic: `skill-load`, `framework-source`, per topic (context, drivers, dom-events, parent-child, collections) | "What learning time went to" | `skill-load` falls; `framework-source` must not rise by more than it falls |
| `llms.txt` reads: trials, bytes, which ranges | "Most-read node_modules/sygnal files" + transcripts | more trials may read it, but as targeted ranges (lean-routed: the named `sed` commands) rather than whole-file greps |
| `dist/` reads | same | should fall to about 0 (baseline: 32 calls in 13 trials, all on tasks 11, 13, 15 and 17) |
| Build/test iterations, failed runs, edit rounds | headline table | unchanged; a rise means a cut fact was load-bearing |
| Debug time and failures by category | time sinks, "Failures" | unchanged (pass rate is saturated at Opus 5.5, so watch first-run failures instead) |
| Canonical forms, strict findings | "Canonical forms in Sygnal solutions" | unchanged: the variants keep every canonical form, so new SYG5xx findings would mean an agent fell back on a form the lean skill no longer shows |
| Recipes table use (lean-routed) | transcripts: `sed -n '/^###` commands | the routed commands appear; if agents ignore them, the table is dead weight |

**Decision rule (proposal):** adopt the smallest variant whose mean wall time is no worse than current (within noise: about ±3 s per trial at 5 trials × 17 tasks) and whose peak context is at least 2k lower, with no rise in iterations or SYG5xx findings. If lean and lean-routed tie, prefer lean (fewer bytes) unless the routed commands visibly replace whole-file greps. Whatever wins, fold the added facts into llms.txt (candidates 1–3 above) so the spec and the skill agree.
