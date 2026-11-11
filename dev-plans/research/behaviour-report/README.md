# Behaviour report: what a change does, derived from the code

Spike, 2026-11-09. Prototype behind `sygnal-check --report --base <ref> [--head <ref>] [--json] [--out <file>]`
(`sygnal-check/src/report/`, tests in `sygnal-check/test/behaviour-report.vtest.js`).

## Recommendation

**Yes: an experimental release, as a *checked inventory of what changed* for wiring and side effects.** It is a review-focus tool, not a bug finder, and the real application history (section 9) is what settled that.

- On 47 real commits from Sift and Temper it changed what a reviewer would look at in 8, gave a useful inventory of a large change in 10, and had nothing to add in 29, where it mostly stayed quiet. After tuning, none of the 47 misdirected.
- It would not have caught the bugs. Of 17 commits named as fixes, none had the defect flagged on the commit that introduced it. Those bugs were markup, omissions in new code, or wrong literals.
- In 23 of the 84 example commits with a report, the graph diff says "no changes".
- It says what differs. "Nothing to look at first" must never read as "safe".

What still stands between this and a release is at the end of this file. The provisional decisions the strategy session made for the maintainer are in section 8.

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

Three existing bugs turned up, each now fixed in its own commit on this branch:

- A model entry written as `A: emit('T')` was read as a STATE reducer. In bd18dc24 the graph diff said `+sink DELETE_LANE:STATE, -sink DELETE_LANE:EVENTS`, which was false.
- A diagnostic whose message contains a line number read as removed and added when code moved (64d57674, SYG701).
- `--graph` crashed on `CHILD.select(Fn)` of a function no view renders. It hit 8 of the 47 Sift commits.

## 2. The prototype

`facts.js` extracts per action: triggers (DOM event and selector, EVENTS, CHILD, keymap keys, followed through local consts, with `.filter` conditions), and per
sink: reads, guards with their full condition path, conditions and branch count, written keys and what each key receives, requests (method, URL, reply actions),
EVENTS types, payload shape, globals touched. `canon.js` makes those comparable: a fingerprint that ignores formatting, comments, types and parameter and
local names, treats a one-return block as an expression, `{ ...s, a }` as `set({ a })`, `{ type, data }` as `event()`, and includes the module-level helpers a function
reaches (5 levels, imported ones too). `compare.js` diffs two sides into the report, the attention list and the blast radius. `markdown.js` prints the PR comment.

The report also says what it did not explain: changed code files with no behaviour difference found, non-code files, tests, and components whose model can't be listed.

Helpers are followed: a helper in return position (3 calls deep, also `track(step(state))`) is read as part of the sink, so a guard moved into one hashes as it did in place. Writes follow what is made from the state (`reducerWrites` with `deep`; the graph's own `writes` are unchanged). Of an object used only as `api.x`, each key used is a dependency, not the whole object.

`--head <ref>` is new and also works with `--graph --base`. It is what makes the commit-pair study below reproducible.

The first list ("Look at these first", `attention` in the JSON): side effects added to existing actions, removed guards and trigger filters, wider writes. Everything else worth a line ("Also changed", `notes`): new drivers, changed guards, persistence, agent surface, payload shape, new findings, dropped branches, orphaned listeners, clock reads, low-confidence changes. A helper that changed and reaches several components with nothing else to say gets one line under "Shared helpers that changed", and those components fold away.

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
| 6 | bd18dc24 reducers rewritten with `set()`, `emit()` | kanban | Misleading before the `emit` fix, now "no changes" | Yes: the refactor reads as a refactor |
| 7 | ee35c135 camera moved to state | platformer | Barely | No, and it says so |
| 8 | 64d57674 2048 typed intent, view signature | ts-example-2048 | Noise | Noise, smaller |

**1. a990ebbc.** The real change: entering the wizard from another page no longer resets the flow here, the library's `restart` default does.

Today:
```
app graph: a990ebbc~1 (f933f615e1) → a990ebbc
no changes
```
Prototype (now under "Also changed"):
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

**4. 916e23e7.** The report gives the guards (`LANE_DROP` stops when `!state.draggingLane`), the new `BOOTSTRAP` DND config, and the blast radius. It lists `main.js`
as changed with no behaviour found, and that is a miss: the commit moved the `DND` driver's options out of `makeDragDriver({...})` and into `BOOTSTRAP`. The driver's name didn't change, and names are all the report compares.

**5. 43026613.** Today: "no changes". Prototype:
```
| ~ | `LANE_DRAG_START` | rewired: + `DND.dragstart(lane-sort).data(laneId)`, − `DND.dragstart(lane-sort)` | STATE, writes draggingLane (same) | values: what it puts in `draggingLane` differs |
```

**6. bd18dc24 (the control).** The graph diff reported three false sink changes until the `emit` fix. The report: only `DRAG_START`, which really changed its payload; the other rewrites are
recognized as the same code and `LaneComponent.jsx` is listed under "no behaviour difference found". This is the case that shows the canonicalization is worth having.

**7. ee35c135 (the limit).** The commit moves the camera into state and changes `sim.ts`. The report now follows `step` into the simulation and names the conditions that are gone from `Game.STEP`. A reviewer learns where to look and which branches moved, not what the game now does.

**8. 64d57674.** The view signature moved from positional to destructured, so reads appear that were unreadable before. Both tools report that; the prototype at least drops the fake new SYG701.

### Across the history

All 103 commits touching an example's `src` (`--no-config`, up to 40 per example), at the end of this work:

| | |
|---|---|
| Commits where a component's behaviour or code differs | 84 |
| of those, where the graph diff says "no changes" | 23 |
| Components changed | 283 |
| Sinks with classified logic changes | 74 (53 high confidence, 21 low) |
| Kinds (a sink can have several) | value 24, helper 17, condition 12, writes 11, guard 11, branch 11, other 9, payload 5 |
| Attention list, all commits | 8 items: 6 wider writes, 2 side effects |
| Time per report | 221 ms (both sides) |
| Crashes | 0 |

I read the guard-changed items against their diffs. They are real: 8 are the 7.0 `state` → `previousState` migration and one is `steps + 1 < MAX` → `steps < MAX`. They are notes now, not attention items, by the provisional decision. The other kinds I checked by their text, so treat their precision as unmeasured.

## 4. Reducer-level semantic diffing: is it useful, and where does it stop?

**Useful as triage, not as understanding.** 69 % of the classified changes in the examples (51 of 74) got a specific kind rather than "only a helper changed" (14) or "the computation changed" (9). What it can do reliably:

- Tell *unchanged* from *changed*, across formatting and renames, with helpers included. This is the strong result.
- Name the written key whose expression changed, the condition that changed, the guard that went away, also in a helper.

**Following helpers (open question 7 of the first round), before and after:**

| | Before | After |
|---|---|---|
| Low confidence, the original definition | 27 of 74 | 25 of 74 |
| Low confidence, excluding "reads can't be listed" | n/a | 21 of 74 |
| Sinks reported only as "a helper changed" | 17 | 14 |
| Guard weakened in a helper | no alarm | "guard changed", with the helper named |
| Guard moved into a helper | false "guard removed" | no alarm |

Most of the drop came from a bug, not the feature: objects at module scope looked like unreadable imports. The new definition drops "reads can't be listed" because the reads line already carries a `…` for that, and it doesn't make the classification less sure. So the honest figure is 27 → 25 on the same definition. The remaining 21 are 15 unknown writes (a reducer delegating to a method call, as `figma-lite`'s `history` does) and 6 helpers it can't follow.

What it cannot do, each pinned by a test in the "known limits" block:

| Case | What happens | Kind of error |
|---|---|---|
| A sort comparator flipped, or any change of meaning in an expression | "value of `items` differs", no attention item | **False calm**: the order is reversed and nothing is flagged |
| The data the reducer receives changes meaning (the intent's `.map`) | a trigger note on the action, no change on the reducer, no attention item | **False calm** |
| A guard changed in a helper | with the same comparisons: "guard weakened" (first list) or "now also stops", with a case; otherwise "guard changed" (section 10) | Direction only when it can be worked out |
| A wrong literal in a request (`modal_vllm` for `modal_pool`) | "the request differs: read its arguments" in the table | **False calm**: section 9 |
| Library, driver or package behaviour changes | nothing; a version bump in `package.json` is a non-code file | **False calm** |
| View output | "view code changed" and the state reads. Conditional rendering, text, a11y are not classified | Out of scope, said in the report |
| A guard moved where the walk doesn't reach (`const t = add(s); return t`) | "guard removed", medium, names the helper | False alarm (softened) |
| An equivalent rewrite of a guard (`!(a && b)` → `!a \|\| !b`, parentheses, an if / return chain) | "guard rewritten, same condition" (section 10) | Fixed |
| An equivalent rewrite of a value (`n + 1` → `1 + n`) | changed value | False alarm |
| A reducer that mutates locals or dispatches through a table | low confidence, "read the diff" | Honest |

The false-calm row is the one to be careful about. The classifier sees that an expression differs, and cannot say whether the difference matters. A guard with a changed condition can't be
called stricter or looser. It could be with a solver on simple comparisons, but that doesn't seem worth it. So the report's strong claims should be confined to what it *can* check: existence of sinks, requests,
written keys, guards and edges. Everything about logic should stay phrased as "this differs".

One wording rule follows, and the prototype keeps to it: never print "safe" or "no behaviour change". With nothing on the list it says only that nothing is on the list.

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
- No natural-language layer, by decision (section 8). A model paraphrasing this JSON would be cheap, but it reintroduces the unfaithfulness this report exists to avoid.
- Driver names only: a changed driver *configuration* in `run()` still reads as "no behaviour found".

## 6. A GitHub Action

[`example/.github/workflows/behaviour-report.yml`](example/.github/workflows/behaviour-report.yml) is an example for an application repository (not this repo's `.github/`); the docs have the short form in `guide/app-graph`. It finds the merge base, runs the report, truncates to fit GitHub's 65,536-character limit, writes the job summary,
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

## 8. Decisions and open questions

**Provisional decisions, made by the strategy session so this wasn't blocked; the maintainer can overrule any of them:**

1. `--report` stays a separate flag.
2. Severity is informational, with an opt-in `--fail-on=high`.
3. New driver sinks on new actions go in the table. Only side effects added to existing actions, removed guards and wider writes go on the first list.
4. There is an MCP `report` tool.
5. No natural-language layer.

**Open for the maintainer:**

1. Should the facts go into `InspectGraph` (per-action `reads`, `guards`, `requests`) so the page and the MCP `graph` tool get them? It would raise the schema's size and its promise.
2. The first list leaves out a new driver in `run()`, changed guards and persistence changes. Reading the application history, a changed guard was as often the interesting line as a removed one. Promote "guard changed"?
3. Should `reducerWrites` with `deep` become the graph's own `writes`? It's more complete, and `action.writes` would change for existing users.

## 9. Real application history: Sift and Temper

**Set-up.** `UsableMachines/kindo-sift-module` (the `frontend/` console, Sygnal since 2026-11-01) and `UsableMachines/kindo-tune-module` (Temper, `kindo-tune/ui`). Read-only clones outside this repository, with the push URL disabled. 47 commits: 17 whose subject names a fix, and 30 spread evenly over the rest (23 from Sift, 24 from Temper). Average 1.9 s per report on apps of this size. I judged each commit alone, from the report and the commit's subject and diffstat, and read the diffs of the flagged ones. That's one reader's judgement, and the fix sample leans on subject lines, several of which turned out to be bundles or features.

**Would the report have changed what a reviewer looked at?**

| Verdict | Commits | |
|---|---|---|
| Yes: a concrete behaviour fact the title and diffstat don't give | 8 | Sift 276d0a7c, ec6460b3, 521edc08; Temper c0b95025, 0c93835c, 0d676f50, de3cf8e1, f68c3bac |
| Inventory: a large port or feature, the table orients but flags nothing | 10 | Sift 8b8d02bb, 831073fe, 73b5d875, 881a7b18, 844b7a06; Temper 902fed76, cf22e24c, 41968960, 146c6711, 399e2e59 |
| Nothing to add: view-only, comments, generated code, a module no component reaches | 29 | |

Examples of the first row:

- c0b95025, a 40-file batch titled "batch of fixes": among 48 components, the first list singles out `ProjectsPage.CLONE` no longer stopping when `state.busy` (the action became a confirm step) and `ARCHIVE` writing three more keys.
- f68c3bac: the note `Wizard.GOTO` guard became `… || (to === 'publish' && !canPublish(state))`, a new rule in a commit titled about scorecard rendering and wordmark contrast.
- 0c93835c: `App.ROUTE` now has an EFFECT calling `window.location.assign`, and both guards changed.
- ec6460b3, titled "drop the workarounds": a PARENT payload to the wizard lost `query`, which is the point of the change and easy to miss in the diff.

What the trial changed, all fixed:

- The first run crashed on 8 Sift commits (a graph bug, section 1).
- Generated clients reported 27 components changed for a one-file API regeneration, because all of `api` was a dependency. Four commits went from 15 to 27 components each to none. It now tracks `api.x`.
- `toProblem`, a shared helper, turned a branding commit into 50 components. It's one line now.
- A respelled reply name (`ok: actions.ok` → `'TRIED'`) was reported as a new request.
- The attention list was noisier before the provisional decision: 41 of 47 commits now have nothing on it, and 25 items across the 47.

**The bugs: would the report on the commit that introduced them have flagged the line?** For each of the 17 fix-named commits I blamed the lines it removed and ran the report on the top 3 commits that wrote them. No report flagged a defect. In 5 of 17, the same action was on the introducing commit's first list (0c93835c, 0d676f50, 1470934a, 8f0e404d, de3cf8e1), which at best points a reviewer at the right action: `Health.FIX_ALL sends a new HTTP request` is true, and says nothing about the later finding that Fix all shouldn't apply fixes that remove much of the data. The reasons are structural:

- Most of the "bugs" were markup or text (d17caa20, f9b7e3ad, 39265b62, 494c075b).
- Others were omissions in new code: state that didn't survive a reload (0d676f50), a missing data check. The first list deliberately doesn't cover new actions, and a report can't see what isn't there.
- 4a1073f6 was a wrong literal in a request. The report shows the request differs and can't know the value is wrong.

Blame is rough here (comments and imports count as written lines), so read this as "no evidence it finds bugs", not a measured miss rate.

## 10. Three fixes from the review eval (for 7.5)

The read-side review eval (`dev-plans/research/read-side-eval`, the claims tier's closing statement, on another branch) found three defects in the report. It used tasks 80 (an honest refactor of an inbox app), 85 (a beacon sent from the view) and 86 (a De Morgan slip in `canSend`). Minimal versions of the three are this package's own fixtures (`sygnal-check/test/fixtures/report-inbox`), each with its negative.

**1. A change inside a helper body was invisible.** Guards are now boolean formulas (`src/report/logic.js`): `&&`, `||`, `!`, `?:` and literals are structure, and everything else is an atom (a comparison, with `!==` as `===` negated and operands sorted). A call to one of the app's functions made of `if`, `return` and `const` is written out with its arguments. The condition under which a sink does nothing is compared before and after by truth table, up to 12 atoms. The report states a direction only when both versions use the same atoms: a truth table treats `n > 3` and `n > 5` as independent, so a case built from atoms only one side has may be impossible. "Same" needs no such care: two formulas that agree on every assignment agree on every possible one. Each changed helper that exists before and after is also compared case by case ("rewritten, same logic", "returns differ", or "not compared" with the reason). A helper whose returns differ as a condition gets one note with both versions and a case.

**2. A pure refactor produced top-priority lines.** Each request now carries a signature: every key's value written out, with a helper's parameters as the call passed them, the app's one-expression functions inlined, nested templates spliced (`${ticketUrl(id)}/close` = `/api/tickets/${id}/close`), and any other helper named with a hash of it and what it uses. A request whose text differs and whose signature is equal is "same request", not a new side effect. Guards that differ only in parentheses or in where the `!` sits compare as the same formula. Conditions and branches inside a helper count with the helper. Those of a helper only one version has are compared, so a `map` moved into `replaceTicket` is "same values written". A helper both versions call is reported once, as that helper's change. The kind for "the code differs but what it sends or writes compares equal" is `moved`, shown as "rewritten". It needs every changed helper the sink uses to be new or to compare the same.

**3. Effects outside an output barely registered.** A SYG265 / SYG266 (and strict SYG511 / SYG512) that the change introduces is a new side effect on the first list, with the call site the checker found. On the merged branch, SYG265 had reached the report only as an "Also changed: New finding" line. In the eval's generated report it wasn't there at all.

The three cases, the first list and the changed rows, before → after (generated from the eval's trees with `generate.mjs`'s materialiser, outside the repo):

| Task | Before | After |
|---|---|---|
| 80 honest | 2 × "New side effect: sends a new HTTP request" (CLOSE, SEND), "Branch removed: `t.id === ticket.id`", "Guard changed: `!canSend(…)` became `!(canSend(…))`" | none of those. Rows: CLOSE / SEND "rewritten: same request …, now built through `closeRequest` / `replyRequest`, `ticketUrl`"; CLOSED "rewritten: same values written, now built through `replaceTicket`"; SEND "also changed: `canSend` (rewritten, same logic)" |
| 86 slip | byte-identical to 80's | "**Guard weakened**: `TicketDetail.SEND` HTTP: the guard no longer stops when `ticket.status === 'open'` is false and `draft.trim().length === 0` is false; it reads `!canSend(state.selected, draftOf(state))` as before (through `canSend`)", plus "Helper differs: `canSend` … false before, true now. Before: `return ticket.status === 'open' && draft.trim().length > 0`. Now: `if (ticket.status !== "open" && draft.trim().length === 0) return false; return true`" |
| 85 beacon | 80's lines plus "Also changed: New finding: SYG265 …" | "**New side effect**: the view of 'TicketDetail' calls `markSeen(state.selectedId)`, which runs `navigator.sendBeacon`: a network request that no model entry declares (SYG265) (`src/TicketDetail.jsx:8`)", and otherwise 80's report |

The one line all three keep on the first list, "Wider writes: `App.PICK_FOLDER` now also writes `query`", is a real change in the pull request.

**History, old code against new on the same commits.**

- Examples (103 commits): the first list is unchanged (8 items). Notes go from 103 to 105. Both new ones are real: a guard that now reads `previousState`, in the 7.0 migration, and branches in a new helper. 7 rows go from "the computation changed" to "rewritten". All 7 checked by hand: 6 are `return state` → `return ABORT`, the same no-op, and one is a move into a helper. Request signatures add "payload" to 7 LLM rows in the 7.0 migration, where the request now reads `previousState`: also real. Time per report: 264 → 268 ms.
- Sift and Temper (the 47 commits of section 9): the first list goes from 25 to 26 items. The new one is a SYG266 storage write in a reducer (`rememberView` → `localStorage.setItem`), moved up from "New finding". Notes stay at 34, with 7 commits changed. One commit where a helper used by five guards changed (`redirectFor`) now has one line naming the five guards. A `branch-removed` for a deleted helper (`editorStamp` and its `creating` condition) is new and true. A `branch-removed` attributed to a helper both versions call (`resumeStep`) is gone; that commit now shows the real new condition (`to === 'publish' && !canPublish(state)`). Guard texts lose redundant parentheses (`!(account)` → `!account`). Time per report: 2.0 → 2.3 s, measured on a loaded machine (load average 14–27).

What is still not precise:

- Atoms are independent, so a direction ("weakened", "now also stops") is given only when both versions use the same atoms. A threshold change (`> 3` → `> 5`) is "guard changed" without a direction, as before.
- `.length` is taken to be a whole number of 0 or more (`> 0` = `!== 0` = `>= 1`). An object whose `length` is negative or fractional would make that wrong.
- A helper with loops, `let`, assignments or `try` is "not compared", never "same". So is a condition with more than 12 atoms.
- Values aren't compared for meaning (`n + 1` vs `1 + n` still differ), and an address built with `+` is compared as written.
- The displayed request text is still as written (`POST ${ticketUrl(id)}/close`). The signature behind "same request" is not shown.
- A guard whose text is unchanged, and whose atoms changed through a helper it reaches only through a local (`const w = newWorld(…); if (w === state)`), isn't a guard change: the helper's change is reported once as a changed helper. That keeps the history quiet. It also means such a guard change is said only through the helper line.

## 11. What stands between this and a release

1. The maintainer's view on the provisional decisions, and on promoting "guard changed" (question 2).
2. The report's JSON has no schema file and is unversioned. It needs one before anyone depends on it, as `inspect.schema.json` does for the graph.
3. Trial on a live PR flow: the Action has never run on GitHub. The comment format has only been read as text.
4. The docs section builds and passes the link and file-name-tab checks; the page's live examples were not re-run in the three browsers.
5. A changelog entry and `sygnal-check` version bump at release time.
6. Blast radius precision past helper boundaries is unmeasured.
