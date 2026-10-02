# p4-final vs p4-baseline: why tasks 12, 13 and 14 got slower

**Question.** `p4-final` (branch build at tag `plan2-p4-final-build`, starter v2 with sygnal-check and AGENTS.md/CLAUDE.md, `branch` skill) runs more build/test iterations and has more failed runs than `p4-baseline` (published 5.4.0, starter v1, 5.4.0 skill) on 12-selection-panel, 13-course-portal and 14-fix-support-inbox. Every trial still passes.

**Short answer.** No branch change broke the framework. Three harness problems account for 33 of the 39 failed runs on these tasks. The new skill and starter text now steer agents into each of them:

| # | Cause | Kind | Trials hit | Failed runs | Also in 5.4.0? | Fixed on HEAD? |
|---|---|---|---|---|---|---|
| C1 | **Stale calculated fields in `t.state` / `t.states`.** When a child component's reducer changes the state (a Collection item, or a child with `state="activity"`), the recorded root state keeps the old stored `calculated` values. The rendered view is correct. | Old framework/harness bug, exposed far more often by the skill now documenting `t.state` (G-125) | 12: t1 t2 t3; 14: t1 t2 t3 t5 | 20 | **Yes**: same repro fails on 5.4.0, and baseline 14-t3 hit it (2 runs) | **No** |
| C2 | **The fake HTTP source tracks requests by object identity.** The retry re-sends the same constant request object after `t.fail`, so `t.respond` reports "no pending HTTP request after 1000ms … all answered". | New-feature bug (E2 fake sources / `t.respond`), not a regression | 13: all 5 | 5 (+4 reruns because `tail` cut the error off) | No (5.4.0 has no `t.respond`) | **No** |
| C3 | **`t.html()` escapes `'` as `&#39;` in text.** Agents wrote `toContain("Couldn't load courses.")`. | Old behaviour (SSR `escapeHtml`), newly hit because the skill steers 13 toward `t.html()` and the fake HTTP source. In 5.4.0 agents mocked `fetch` and read `textContent`. | 13: t1 t3 t4 t5 | 4 | Yes (same `renderToString`) | **No** |
| — | Agent mistakes: wrong arithmetic in its own test, debug scratch files that didn't compile, `next()` called after the state had already arrived | Noise | 12-t1 t4; 14-t1 t3 | 6 | — | — |

None of the suspected branch changes appear in any failure: 3-F Switchable keep-alive / R4-1, 4-A1 `html()` before first render, the G-065/G-129 `next()` changes, SYG609 or strict diagnostics, real-DOM holds. Only one `next()` message shows up (14-t1, "A state recorded before this next() call already matches … use t.waitForState"), and it is the intended G-129 hint: the agent followed it and went green on the next run.

sygnal-check (starter v2) did not cause any failures. On task 14 its SYG104 warning on the starter (`'.assign' … only rendered inside child component <TicketList>`) points straight at bug 2, so it helped. The 4 SYG104 orientation runs in 14 are not counted as failed runs by the analyzer, and are excluded from the counts here.

## Evidence: per-trial failed runs (p4-final)

Counts match `analysis/p4-final.md`: 12 = 9 runs (1.8/trial), 13 = 13 (2.6), 14 = 17 (3.4).

### 12-selection-panel

| Trial | Failed run (key lines) | Agent's conclusion | Change that got past it | Cause |
|---|---|---|---|---|
| t1 | `expect(t.state.openCount).toBe(5)` → `expected 4 to be 5`; `await t.next(s => s.openCount === 3)` → `next timed out after 2000ms` | Debug test printed `t.states` = `[[4,[f,t,f]],[4,[f,f,f]]]`, while the HTML said "5 open". "The recorded test state just carries a stale calculated `openCount`" | Assert on `t.html()` `'5 open'`; wait on `tasks[0].done` instead of `openCount` | C1 (both failures) |
| t1 | Debug file: `Transform failed … PARSE_ERROR` (a sed rewrite of its own debug test broke it) | — | Rewrote the debug file | noise |
| t2 | `expect(t.state.openCount).toBe(2)` → `expected 4 to be 2` | Thought its expected value was wrong (4 open − 1 = 3) | Changed to 3, which still failed (shown with no detail, then `expected 4 to be 3`); deleted the `openCount` assertion | Agent arithmetic first, then C1 (3 runs) |
| t3 | Same as t2: `expected 4 to be 2`, then `expected 4 to be 3` | Same | Replaced with `t.html()` `"3 open<"` / `"4 open<"` | Arithmetic, then C1 (3 runs) |
| t4 | `t.query('.summary').textContent` → `expected '3 open' to be '2 open'` | "I had the expected count wrong" (correct) | `'3 open'` | Agent arithmetic (noise) |
| t5 | — (first run green) | | | |

### 13-course-portal

Every trial's App sent `HTTP: () => COURSES_REQUEST` (one module-level constant) on first load and again on Retry. Every trial's test did `t.fail('HTTP', 500)`, then clicked Retry, then `t.respond('HTTP', …)`.

| Trial | Failed runs (key lines) | Agent's conclusion | Change that got past it | Cause |
|---|---|---|---|---|
| t1 | (1) `expected '<div class="portal">…' to contain 'Couldn't load courses.'`; (2) `Tests 1 failed` with the error cut off by `tail -6`; (3) `t.respond('HTTP'): no pending HTTP request after 1000ms. The component sent 2 …, all answered, aborted or superseded` | "HTML escaping"; then "the shared request object is tracked by identity" | `toContain('Couldn&#39;t …')`; `coursesRequest = () => ({…})` factory | C3, then C2 (2 runs) |
| t2 | (1) `t.respond … no pending HTTP request after 1000ms` | "Likely the shared request object is tracked by identity; build a fresh one each time" | Factory | C2 |
| t3 | (1) escaping; (2) cut off; (3) `no pending HTTP request` (agent read `testing.ts` 1060-1130) | Same | `&#39;`; factory | C3, C2 ×2 |
| t4 | (1) escaping; (2) cut off; (3) `no pending HTTP request` | "The shared `COURSES_REQUEST` object is likely being identified as the already-failed request" | `&#39;`; factory | C3, C2 ×2 |
| t5 | (1) escaping; (2) cut off; (3) `no pending HTTP request` | "Both requests are the same constant object, so the test harness treats the retry as already answered" | `&#39;`; factory | C3, C2 ×2 |

Baseline 13 (5.4.0) had no `t.respond`. Agents stubbed `fetch` with `vi.fn()` and asserted on `textContent`, so neither problem could show up (baseline: 1 failed run in 5 trials).

### 14-fix-support-inbox

Both bugs live in the parent's derived counts (`App.calculated` `openCount` and `mineCount`). The fixes change tickets inside the `TicketCard` Collection, or have `ActivityLog` (`state="activity"`) add entries, so every state change the tests look at comes from a child.

| Trial | Failed runs (key lines) | Agent's conclusion | Change that got past it | Cause |
|---|---|---|---|---|
| t1 | (1) `t.state.openCount` / `next(... mineCount …)` → `next timed out after 2000ms` (2 tests); (2) debug `TypeError: Unknown encoding: []` (bad `process.stdout.write` call); (3)-(5) debug throws: `[[null,0,3],["Priya",0,3]]`, then `counts">3 open · 1 assigned to me<` | "`mineCount` stays stale in recorded state" | Assert on `t.html()` counts | C1 (1, 3-5); noise (2) |
| t1 | (6) cut off; (7) `next timed out … A state recorded before this next() call already matches (t.states[2]) … Use t.waitForState` | Followed the hint | `waitForState` | noise (agent ordering; the message did its job) |
| t2 | (1) `next timed out` + `expected 3 to be 2` (`t.state.openCount`); (2) same with full output | "The `openCount` assertion probably ran on an intermediate state" | Inspected states, rewrote the tests to read `t.html()` | C1 (2 runs; plus an uncounted debug run) |
| t3 | (1) cut off; (2) `expected 3 to be 2` (`openCount`), `expected +0 to be 1` (`mineCount`) | — | `await t.settle(); expect(t.html()).toContain("2 open · 0 assigned to me")` | C1 (2) |
| t3 | (3) `match(/Assign to me/g)).toHaveLength(1)` | "My count was off" | `toHaveLength(2)` | noise |
| t4 | — (green; only the starter's SYG104) | | | |
| t5 | (1) cut off; (2) `expected 3 to be 2`, `expected +0 to be 1`; (3) after "make the test wait on the calculated values directly": `next timed out` ×2 (4 is the same run with detail); (5) debug: `[[3,"open",0],[3,"closed",0],[3,"closed",1]]counts">2 open · 0 assigned to me` | "My test's assumption about when calculated fields appear in `t.state` is off" | Rewrote the test against `t.html()` | C1 (5) |

Baseline 14-t3 (5.4.0) failed the same way (`expected +0 to be 1`, `expected 3 to be 2` via `t.states.at(-1)`) for 2 runs. C1 is not new.

### Why agents now trip on C1 (steering, not a regression)

Asserts on a calculated field in state (`t.state.openCount`, `mineCount`, or `s.openCount` in a predicate), counted per transcript:

| | 12 t1-t5 | 14 t1-t5 |
|---|---|---|
| p4-baseline | 0 0 0 0 0 | 0 0 4 0 0 |
| p4-final | 10 5 6 0 0 | 5 7 7 0 13 |

Three pieces of text now lead agents there, and none mentions the limitation:
- The skill and `llms.txt` say "`t.state` is the latest state (`t.states.at(-1)`)" (G-125 added `t.state`).
- `llms.txt:25` says calculated fields are "read as state.double".
- The AGENTS.md test recipe is `await t.next(s => …)`.

In 5.4.0 agents mostly asserted on rendered text.

## Reproductions (tag vs HEAD vs 5.4.0)

Scratch builds: `git archive plan2-p4-final-build` → `/tmp/diag/tag`, `git archive HEAD` (40ffa3e: 4-R, 4-T and E10 merged) → `/tmp/diag/head`, each with `npm ci && npm run build`. 5.4.0 is the baseline trial's `node_modules/sygnal`. Repro projects: `/tmp/diag/repro-{tag,head,v540}/src/{calc,http}.test.jsx`.

| Repro | 5.4.0 | tag | HEAD |
|---|---|---|---|
| `calc`: a Collection item toggles `done`; root `calculated.openCount` | HTML `1 open`, `t.states.map(s=>s.openCount)` = `[2,2]`: **fails** | same: **fails** | same: **fails** |
| `calc`: the root's own reducer adds an item | passes (`openCount` 3) | passes | passes |
| `http`: `t.fail` then `t.respond` on a re-sent constant request object | n/a (`HTTP.errors` missing) | **fails**: `no pending HTTP request after 1000ms … all answered` | **fails** (same) |
| `t.html()` text containing `'` | `Couldn&#39;t` | `Couldn&#39;t` | `Couldn&#39;t` |

Code locations (HEAD):
- **C1**: `src/component.ts:1158`. Calculated values are stored into state only inside the component's own reducer wrapper (`storeCalculatedInState ? this.addCalculated(incomingState)`). A child's lens `set` writes the raw parent object, which carries the previous calculated values, and nothing recomputes them. Views, context and child lenses call `addCalculated` on read (`:639`, `:1175`, `:1350`), so the app renders correctly. Only the raw STATE stream is stale, and `renderComponent` records exactly that stream (`testing.ts`: `listen(stateStream, s => states.push(s))`).
- **C2**: `src/extra/testing.ts:1285` `const answered = new WeakSet<object>()`, and `:1296` `if (!r.abort && !answered.has(raw)) live.push(…)`. A second send of the same object counts as already answered. The real `makeFetchDriver` (`fetchDriver.ts`) does not de-duplicate by identity, so the app code was valid.
- **C3**: `src/extra/ssr.ts:23` `escapeHtml` escapes `[&<>"']` in text nodes. Browser `innerHTML` escapes only `& < >` there.

## Recommended fixes (none of the three is fixed on HEAD)

1. **C1, stale calculated values.** This fix has the most impact: 20 of 39 failed runs, and most of the extra debug time on 12 and 14.
   - **Harness:** record states with calculated values recomputed. In `renderComponent`, map the root STATE stream through the root component's `addCalculated` (memoised) before pushing to `states`. `t.state`, `t.states`, `next` and `waitForState` then match what the view shows.
   - **Core (better):** recompute stored calculated values whenever the root state changes from a child lens write. One option is a final pass in the `withState` reducer fold for components with `storeCalculatedInState`, so the STATE stream is never stale for anyone (devtools, `STATE` observers).
   - Add a regression test like `/tmp/diag/src/calc.test.jsx`, and a changelog entry, since 5.4.0 has the bug too.
   - Until it ships, add one line to the skill / `llms.txt` testing facts: "calculated fields in `t.state` can lag after a child's update: assert on `t.html()`."
2. **C2, fake HTTP identity.** Track pending and answered requests per send, not per object. Keep a list of `{raw, seq}` entries, mark the entry as answered, and have an explicit `{ request }` match the newest pending entry whose `raw === request`. Add a test for fail, then retry with the same object, then respond.
3. **C3, `t.html()` escaping.** Make `t.html()` serialise like `innerHTML`: no `&#39;` or `&quot;` in text nodes, which is also safe for SSR text. Alternatively add a `t.text(sel)` helper. Failing that, document "`t.html()` is escaped HTML (`'` → `&#39;`)" next to the `t.html()` line.
4. **Minor (harness and doc tweaks):**
   - `t.respond`'s "no pending" path waits 1 s before failing. Once identity is fixed this is rarely hit, but the message could add "(a request object re-sent unchanged counts as one request)" until then.
   - Agents piping `npm test | tail -6` lose the error and rerun, about 7 runs here. Vitest's summary is outside Sygnal's control, but the AGENTS.md recipe could say `npm test 2>&1 | grep -A15 FAIL`.

With C1-C3 fixed, the expected failed runs on these tasks are about 1 per task in total (agent arithmetic and noise), back to the baseline level. A rerun of 12, 13 and 14 (n=5) after the fixes would confirm it.

## Other notes

- Phase deltas (final − baseline, s/trial):
  - Debug time: 12 +12.0, 13 +17.2, 14 +21.2. This covers most of the wall-time increase on 12 and 14.
  - Learn time on 13 fell by 4.8 s, which offset part of its increase.
  - On 14, test-authoring (+4.7 s) and verify (+3.5 s) include the starter v2 sygnal-check runs, which are cheap and useful (SYG104).
- The remaining `t.respond` "no pending" hits elsewhere (11-t4, 17-t4) are the intended `latest: true` supersession message, not C2.
