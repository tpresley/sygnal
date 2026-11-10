# Behaviour report: what a change does, derived from the code

Spike, 2026-11-09. Prototype behind `sygnal-check --report --base <ref> [--head <ref>] [--json] [--out <file>]`
(`sygnal-check/src/report/`, tests in `sygnal-check/test/behaviour-report.vtest.js`).

## Recommendation

**Yes, make it a release feature, in a narrower form than the prototype's wording suggests, and labelled for what it is.**
Ship it as a *checked inventory of what changed*, with an attention list. Do not ship it as a description of what the
change means.

- It adds information on the commits that matter. In 22 of the 84 commits with a report, today's `--graph --base` says
  "no changes" while the code's behaviour changed or was at least rewritten.
- The attention list stayed quiet on most ordinary edits: 31 of 55 incremental commits had none, and the median was 0.
- Its value is largest for the claim the strategy review cares about: a machine-checked statement that a new request,
  a removed guard or a wider write exists, regardless of what the PR description says.
- It is not a proof of equivalence. "Nothing needs attention" must never read as "safe". Section 4 lists the
  false-calm cases, and they are real.

Keep it `experimental` for one release, and try it on an application repository first. This repository is a poor test
bed: most PRs change the library, which is not a Sygnal app.

## 1. What `--graph --base` leaves out

It diffs `InspectGraph` as sets of names (`graphView/diff.js`). A reviewer cannot learn:

| Gap | Example |
|---|---|
| Any reducer logic change. If the action and sink names are the same, the diff is empty. | a990ebbc changes what `ROUTE` does: "no changes" |
| What triggers an action. `selectors` is a set per component, not tied to an action, and only DOM. | `DOM.click` → `DOM.keydown` on the same selector: no change |
| Intent stream logic: `.filter`, `.map`, `.data()`. | 43026613: "no changes" |
| `writes`: the graph has them per action, the diff never compares them. Only `sinks` and `stateReads` are compared. | an action that starts writing `confirm`: not shown |
| Reads per action (the graph only has reads per component). | |
| Guards (`ABORT` conditions). | removing one: no change |
| What a sink sends: the URL, the method, the reply actions, which EVENTS type each action emits, the payload. | changing `/api/v1` to `/api/v2`: no change |
| Initial state values, calculated and context function bodies (only their names). | `n: 0` → `n: 5`: no change |
| `persist` picks, `agent` tools, timers and other statics. | a new tool an agent can call: no change |
| The view, beyond reads and children. | |
| Helpers. A change in a function a reducer calls. | |
| `run()` drivers. | a new `DND` driver in `main.js` |
| Removed context and PARENT edges under `--base` (as the header of `diff.js` says). | |
| Which changed files it accounted for. "No changes" can't be told apart from "didn't look". | |
| A moved file is a removal plus an addition. | |

Two existing bugs turned up:

- A model entry written as `A: emit('T')` is read as a STATE reducer (`modelEntries.js`, the final `else` of `analyzeModel`). In bd18dc24 the graph
  diff says `+sink DELETE_LANE:STATE, -sink DELETE_LANE:EVENTS`, which is false. The report works around it. The graph itself is still wrong at HEAD,
  and this `emit` form is still supported.
- A diagnostic whose message contains a line number reads as removed and added when code moves (64d57674, SYG701). The diff's own comment says moved
  code isn't a change. The report normalizes this, `graphDiff` doesn't.

## 2. The prototype

`facts.js` extracts per action: triggers (DOM event and selector, EVENTS, CHILD, keymap keys, followed through local consts, with `.filter` conditions), and per
sink: reads, guards with their full condition path, conditions and branch count, written keys and what each key receives, requests (method, URL, reply actions),
EVENTS types, payload shape, globals touched. `canon.js` makes those comparable: a fingerprint that ignores formatting, comments, types and parameter and
local names, treats a one-return block as an expression, `{ ...s, a }` as `set({ a })`, `{ type, data }` as `event()`, and includes the module-level helpers a function
reaches (5 levels, imported ones too). `compare.js` diffs two sides into the report, the attention list and the blast radius. `markdown.js` prints the PR comment.

The report also says what it did not explain: changed code files with no behaviour difference found, non-code files, tests, and components whose model can't be listed.

`--head <ref>` is new and also works with `--graph --base`. It is what makes the commit-pair study below reproducible.

Attention list: new side effect, new driver, removed guard or trigger filter, may remove a Collection item, persistence changes, agent surface changes (high);
changed guards, wider or unknown writes, removed side effects, payload shape, new findings, dropped branches, orphaned listeners (medium); a clock read in a reducer, new event, low-confidence change (low).

## 3. Worked commits

Full outputs are in [`worked/`](worked/), `N-name.graph.txt` (today) and `N-name.report.md` (prototype). To regenerate one:

```bash
node sygnal-check/bin/sygnal-check.js --report --base a990ebbc~1 --head a990ebbc --no-config examples/filter-wizard/src
```

The verdict column answers: could a reviewer who has not read the code say what changed?

| # | Commit | Example | Today | Prototype |
|---|---|---|---|---|
| 1 | a990ebbc restart default replaces ROUTE workaround | filter-wizard | No. "no changes" | Mostly. Names the dropped condition. Not why it's safe |
| 2 | d3b10f54 pane navigation | tui-tracker | Partly | Yes, for wiring |
| 3 | 73b084d8 dialog() and toasts | tui-tracker | Partly | Yes, for wiring |
| 4 | 916e23e7 lane sorting | kanban | Partly | Yes |
| 5 | 43026613 `.data('laneId')` fix | kanban | No. "no changes" | Yes |
| 6 | bd18dc24 reducers rewritten with `set()`, `emit()` | kanban | Misleading | Yes: the refactor reads as a refactor |
| 7 | ee35c135 camera moved to state | platformer | Barely | No, and it says so |
| 8 | 64d57674 2048 typed intent, view signature | ts-example-2048 | Noise | Noise, smaller |

**1. a990ebbc.** The real change: entering the wizard from another page no longer resets the flow here, the library's `restart` default does.

Today:
```
app graph: a990ebbc~1 (f933f615e1) → a990ebbc
no changes
```
Prototype:
```
- **Check** (Branch removed): `App.ROUTE` STATE: logic that depended on `inWizard(state.route)` is gone
| ~ | `ROUTE` | reply | STATE, writes route, flow (same), reads -route | branches, conditions, values: fewer branches (2 → 1);
    condition gone: `inWizard(state.route)`; what it puts in `flow` differs |
```
This is the best case: same names, a real change, and the flag lands on it. It can't tell the reviewer that `restart` covers the old behaviour.

**2. d3b10f54.** Today: `~ IssueRow: +action DETAIL, +action MOVE, +context tabStop`, `~ Tracker: +action TO_DETAIL, +action TO_LIST, +provides tabStop, +selector .detail`.
Prototype adds what changed for the reviewer:
```
- **Check** (Payload): `IssueRow.PICK` PARENT payload changed shape: a value → { pick }; check the receivers
| + | `DETAIL` | + `keydown .issue` when `(e) => e.key === 'ArrowRight'` | + PARENT |  |
| + | `MOVE` | + `keydown .issue` when `(e) => e.key in NAV` | + PARENT |  |
| ~ | `SELECT` | new filter `(m) => m.pick != null` | STATE |  |
**Blast radius:** PARENT → Tracker (SELECT, STEP, TO_DETAIL)
```
Today's output says nothing about `PICK` or `SELECT`, yet that payload change is what could break.

**3. 73b084d8.** Today lists 7 `confirm.*` actions and `-sink SAVED:STATE`. Prototype:
```
- **Check** (Wider writes): `Tracker.ASK_DELETE` now also writes `confirm`
- **Check** (Wider writes): `Tracker.DELETE` now also writes `confirm`
| ~ | `SAVED` | reply | + EVENTS, emits `TOAST`<br>− STATE |  |
| ~ | `CREATED` | `CHILD IssueForm` | + EVENTS, emits `TOAST`<br>STATE, writes issues, selectedId, show, query, view, message → issues, selectedId, show, query, view | ...
```
A reviewer can see "status messages became toasts" from the writes and the emits. The modal's new focus behaviour lives in `sygnal/ui` and is invisible.

**4. 916e23e7.** Prototype gives the guards (`LANE_DROP` stops when `!state.draggingLane`), the new `BOOTSTRAP` DND config, and the blast radius. It lists `main.js`
as changed with no behaviour found, and that is a miss: the commit moved the `DND` driver's options out of `makeDragDriver({...})` and into `BOOTSTRAP`. The driver's name didn't change, and names are all the report compares.

**5. 43026613.** Today: "no changes". Prototype:
```
| ~ | `LANE_DRAG_START` | rewired: + `DND.dragstart(lane-sort).data(laneId)`, − `DND.dragstart(lane-sort)` | STATE, writes draggingLane (same) | values: what it puts in `draggingLane` differs |
```

**6. bd18dc24 (the control).** Today reports three false sink changes (the `emit` bug). Prototype: only `DRAG_START`, which really changed its payload; the other rewrites are
recognized as the same code and `LaneComponent.jsx` is listed under "no behaviour difference found". This is the case that shows the canonicalization is worth having.

**7. ee35c135 (the limit).** The commit moves the camera into state and changes `sim.ts`. Prototype: three actions marked `helper changed … (low confidence)`, each naming
`cameraFor`, `clampCam`, and a note to read the diff. Correct and honest, but a reviewer learns only where to look.

**8. 64d57674.** The view signature moved from positional to destructured, so reads appear that were unreadable before. Both tools report that; the prototype at least drops the fake new SYG701.

### Across the history

All 103 commits touching an example's `src` (`--no-config`, up to 40 per example):

| | |
|---|---|
| Commits where a component's behaviour or code differs | 84 |
| of those, where today's diff says "no changes" | 22 |
| Components changed | 283 |
| Sinks with classified logic changes | 74 (47 high confidence, 27 low) |
| Kinds (a sink can have several) | value 22, helper 17, other 14, writes 11, guard 10, branch 7, condition 7, payload 1 |
| Attention items, incremental commits | median 0, p90 4, max 23 (31 of 55 had none) |
| Time per report | 213 ms (both sides) |
| Crashes | 0 |

I read the 9 guard-changed, the 1 guard-removed and the trigger-filter items against their diffs. The guard changes are real: 8 are the 7.0 `state` → `previousState` migration,
one is `steps + 1 < MAX` → `steps < MAX`. The guard-removed is a guard replaced by a different one inside a helper (`firstChoice`), which is why such items are now medium and name the helper.
The remaining kinds I checked by their text, not each diff, so treat their precision as unmeasured. Commits that add a whole example (29) produce a list of everything; grouping
keeps that to one line per component, but a feature PR will be long.

## 4. Reducer-level semantic diffing: is it useful, and where does it stop?

**Useful as triage, not as understanding.** 58 % of the classified changes (43 of 74) got a specific kind rather than "only a helper changed" (17) or "the computation changed" (14). Same writes with different logic
(`value`), a new branch, a changed condition are all recognized, and a key is named when the value is an expression reachable from the return. What it can do reliably:

- Tell *unchanged* from *changed*, across formatting and renames, with helpers included. This is the strong result.
- Name the written key whose expression changed, the condition that changed, the guard that went away.

What it cannot do, each pinned by a test in the "known limits" block:

| Case | What happens | Kind of error |
|---|---|---|
| A guard weakened inside a helper | "helper changed", no guard alarm | **False calm** |
| A sort comparator flipped, or any change of meaning in an expression | "value of `items` differs", no attention item | **False calm**: the order is reversed and nothing is flagged |
| The data the reducer receives changes meaning (the intent's `.map`) | a trigger note on the action, no change on the reducer, no attention item | **False calm** |
| Library, driver or package behaviour changes | nothing; a version bump in `package.json` is a non-code file | **False calm** |
| View output | "view code changed" and the state reads. Conditional rendering, text, a11y are not classified | Out of scope, said in the report |
| A guard moved into a helper | "guard removed", medium, names the helper | False alarm (softened) |
| An equivalent rewrite (`!(a && b)` → `!a \|\| !b`, `n + 1` → `1 + n`) | changed guard or value | False alarm |
| A reducer that mutates locals or dispatches through a table | low confidence, "read the diff" | Honest |

The false-calm row is the one to be careful about. The classifier sees that an expression differs, and cannot say whether the difference matters. A guard with a changed condition can't be
called stricter or looser. It could be with a solver on simple comparisons, but that doesn't seem worth it. So the report's strong claims should be confined to what it *can* check: existence of sinks, requests,
written keys, guards and edges. Everything about logic should stay phrased as "this differs".

Two wording rules follow, both in the prototype: never print "safe" or "no behaviour change" (it prints "no behaviour difference was found" with what wasn't looked at), and "nothing needs attention" must sit next to the "did not look at" section.

The 36 % low-confidence share (27 of 74) is honest but high. It comes mostly from reducers delegating to a simulation (`platformer`) and from mutating locals. It would drop if guards and writes were followed into helpers, as `reducerWrites` already does to depth 3 for writes.

## 5. What worked, what didn't

Worked:
- Fingerprints with helpers included. They make "unchanged" trustworthy and make refactors disappear.
- Guards with their path of conditions, and trigger filters as guards.
- Requests as `POST /api/x → ok SAVED, error FAILED`: the most readable line in the report.
- The coverage section, which turned up the `main.js` driver gap in the first run.
- Blast radius through lenses, Collections, context and calculated fields, with the state's scope respected (`n` in one component isn't `n` in another).

Didn't, or only partly:
- Blast radius past a function boundary: a child reading through a helper shows as "may read it". Upward through a `Collection`, it can only say where the state lives.
- `{ configs }` for a request that isn't HTTP-shaped (DND, LLM): the driver's contract isn't known, so it shows keys.
- No natural-language layer. I left that out on purpose. A model paraphrasing this JSON would be cheap, but it reintroduces the unfaithfulness this report exists to avoid, unless each sentence is tied to a fact.
- Driver names only: a changed driver *configuration* in `run()` still reads as "no behaviour found".

## 6. A GitHub Action

[`behaviour-report.yml`](behaviour-report.yml) is a sketch (not under `.github/`): it finds the merge base, runs the report, truncates to fit GitHub's 65,536-character limit, writes the job summary,
and posts or updates one comment via the marker on the report's first line. The largest report I measured, on the commit with the most attention items, was 15 KB. On a fork the token is read-only, so it only writes the job summary. `pull_request_target` would
get a write token, and `sygnal-check` only parses code and runs none of it, but it would still read config and code from the PR. I'd avoid it until someone asks for fork comments.

**What it would take for this repo.** The examples have `sygnal-check.config.json` and link `sygnal-check` through `file:../..`. The workflow needs (a) `npm ci --prefix sygnal-check` and calling its bin directly,
(b) a matrix from `git diff --name-only` over `examples/*/`, one report per changed example, joined into one comment, (c) the run from each example's directory so its config applies; my study used `--no-config` from the root because old commits lack the config.
That's about 30 lines more. But most PRs here change `src/`, where the report has nothing to say, so the comment would rarely appear.

## 7. Replay evidence on the same comment

**Worth pursuing later, as an opt-in, not now.** I did not run a new experiment here: the numbers come from the record-replay spike (`dev-plans/research/record-replay/README.md`).

It complements this report exactly where this report is weakest. The spike's table shows a model edit produces `divergence at action #2, lanes.3.title: 'New Lane' → 'Untitled'`: a concrete before and after, which is what the false-calm cases lack. Replay is also cheap (about 2 ms per input).

Against it, for now:
- It needs recordings that exist and cover the changed path. A session that never opens the wizard says nothing about a990ebbc. No example or app has a curated set of recordings yet.
- "Replay against base and head" reduces to replay against head: a recording made at base replays on base with no divergence by construction, so only the head run gives information. Building base adds nothing unless the recording is older than base.
- It has to execute the PR's code in CI, which the static report does not. That's a different trust level, and it needs `pull_request` from non-forks, a build, and a test environment.
- A divergence on an intended change is expected. A PR that changes behaviour on purpose will diverge, so the output needs "this diverged, was that intended?" and not pass/fail.

Suggested shape if it is built: `sygnal-check --report --evidence <replay-results.json>`, where the CI job has run `replay()` over a `recordings/` folder through Vitest, and each divergence attaches to the action it names in the report, so "`ROUTE`: value of `flow` differs" could carry "session `wizard-from-list`: `flow.step` `'review'` → `'describe'`".

## 8. Open questions for the maintainer

1. Is `--report` a flag, or should it be `--graph=report`? I kept it separate because it needs facts beyond the graph and has its own JSON shape.
2. Should the facts go into `InspectGraph` (per-action `reads`, `guards`, `requests`) so the page and the MCP `graph` tool get them? It would raise the schema's size and its promise.
3. Do you want an MCP `report` tool, so an agent can check its own PR description against the facts? I left it out to keep the MCP tool list stable during the spike.
4. Should high-severity items be able to fail a check (`--fail-on=high`), or stay informational? I'd start informational: a new request is often the point of a PR.
5. Fix the `emit()` graph bug and the line-number diagnostic bug separately? Both exist today regardless of this feature.
6. Are "Look closely" items a fair default for every new driver sink, given a feature PR will list many? An alternative is to flag only side effects on *existing* actions, and list new actions' effects in the table.
7. Should the report follow guards and writes into helpers (the main false-calm fix)? It's the next most valuable piece of work, and bounded: the same depth-3 walk `reducerWrites` uses.
