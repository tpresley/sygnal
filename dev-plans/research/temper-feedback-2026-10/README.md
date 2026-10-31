# Temper feedback, round 3 (2026-10-26 → 30): assessment

Source: `kindo-temper/.claude/worktrees/competent-dubinsky-2b1a69/vault/Questions/Sygnal Upstream Feedback.md`, the
open items under "From the UI walkthrough" (areas 1 and 2), plus the one item still open from the PLAN-13 round
(Switchable map pages start at mount). Everything else in that file is closed and released in 7.1.0 / 0.12.0.

Checked against branch `claude/advanced-integration` at 9f4c523e (the 7.2 dev preview). No commit since 7.1.0 touches
any of the code involved. Repros were run in a scratchpad against this checkout's `dist/` and `sygnal-check/bin`.
Nothing in `src/` was changed.

## Ranked table

| # | Point (one line) | What the code does now | Class | Recommended action | Effort | Priority |
|---|---|---|---|---|---|---|
| 1 | A default import from `xstream/extra/dropRepeats` passes `tsc` and `sygnal-check --strict`, then fails at run time ("dropRepeats is not a function") | Repro: in Node ESM `import dropRepeats from 'xstream/extra/dropRepeats'` is the module object `{ DropRepeatsOperator, default }`. `sygnal-check --strict --verbose` on that file, with `STATE.stream.map(f).compose(dropRepeats())` in the intent, reports **0 findings**. SYG302 (`rules/syg302-xstream-default-import.js`) matches only `source.value === 'xstream'`. `sygnal` already exports ESM ports of `concat debounce throttle delay dropRepeats sampleCombine` (`src/extra/xstreamExtras.ts`, whose header names this exact CJS problem). llms.txt:274 already says `STATE.watch(fn)`, "not `STATE.stream` + `dropRepeats()`" | Real friction worth a diagnostic change | (a) Extend SYG302 to default imports from `xstream/extra/<name>`. For the six names `sygnal` re-exports, `--fix` rewrites to `import { dropRepeats } from 'sygnal'`, merged into an existing `sygnal` import as the rule already does for `xs`. Other extras (`pairwise`, `flattenConcurrently`, …) get the message without a fix. (b) A new info code (SYG303, free) in the static checker: an intent stream built on `STATE.stream` and composed with `dropRepeats()`. The message points at `STATE.watch(fn)`. Severity: info, or a strict-only warning if you want it to gate `--strict`. Files: `sygnal-check/src/rules/syg302-xstream-default-import.js`, a new `rules/syg303-…js`, `src/extra/diagnostics/codes.ts`, `sygnal-check/src/explanations.js` → `explanations.json` → `gen-error-docs.mjs` | S (a) + S (b) | Next release. (a) is sygnal-check only and could ship before the preview |
| 2 | A Switchable with a per-page `state` map creates every page at mount and runs it hidden, BOOTSTRAP included (Logout's BOOTSTRAP signed users out). Ask: a lazy option, or a docs note | `src/core/hosts/switchable.ts:7–10`: every page is created at mount and stays alive while hidden. Only its first render is deferred (G-121). The header cites **D172: no `lazy` prop**. D172 (PLAN-4.6-status) was decided on **render cost** ("first show is DOM-bound … almost no gain"), not on BOOTSTRAP or other side effects. `guide/switchable.md:70` says "Every page still starts at mount" but doesn't warn about entry side effects or show the one-page pattern. PLAN-13 SP-F3 recommended "docs only" | WAI by decision (D172), docs gap. The lazy option needs your decision | Now: add a "Pages with entry side effects" section to `guide/switchable.md` (BOOTSTRAP of every page runs at mount; the pattern that renders only the current page: `<Switchable key={page} of={{ [page]: PAGES[page] }} current={page} state={{ [page]: … }} />`, with its trade-off: going back re-creates the page, and its slice survives), one sentence on the llms.txt Switchable line (132/229), and a CHANGELOG note under 7.1's F-3. Later, if you reopen D172: `<Switchable mount="shown">` creates a page on first show and keeps it. Files: `src/core/hosts/switchable.ts`, `src/index.d.ts`, `sygnal-check` prop list. Measure the size gate cost | Docs S. Prop M | Docs before the 7.2 preview. Prop: your decision (see below) |
| 3 | After `t.simulateEvent(…)`, `t.query` still shows the old view until a wait | Repro: right after `simulateEvent('.retry','click')`, `t.query('.skel')` is `null`; after `await t.settle()` it's there. `simulateEvent` returns `void` (`index.d.ts:3724`) and queues the input (`later(...)`). `t.settle()` **already exists** and does what the ask describes. llms.txt:306–310 uses it in the example, but neither the `simulateEvent` JSDoc nor the llms.txt rule line (315) says "the event is delivered later: wait (`t.settle()` / `t.next(pred)`) before `t.query`". `query`'s JSDoc says it shows the state of the last wait, which is the opposite case | Docs / llms.txt gap (the asked-for `t.settle()` exists) | Add one sentence to the `simulateEvent` JSDoc (`src/index.d.ts`, `src/extra/testing.ts:406` mirror), llms.txt line 315, and the testing guide (`integration/testing`). Optional, your decision: make `simulateEvent` return a `Promise<void>` that resolves once that input is delivered and the tree is rendered (never rejects, so an un-awaited call adds no unhandled rejection). Then `await t.simulateEvent(…)` reads naturally. Type change `void` → `Promise<void>` is compatible for callers | Docs S. Promise M | Docs before the preview. Promise: next release if you want it |
| 4 | Test DOM: the sibling combinators `+` and `~` throw "Unsupported selector syntax". Ask: support them, or a `t.before(a, b)` helper | Repro: both throw (`parseSel`, `testing.ts:~707`). Order **can** be checked today: `t.queryAll('.empty, .filters')` returns document order (`['filters','empty']` in the repro), but nothing documents that. `MockElement` has `parentElement/children/first/lastElementChild/closest/matches`, but no `nextElementSibling`/`previousElementSibling` (repro: `undefined`). The engine already keeps each vnode's element siblings (`meta` → `sibs`), so `+`/`~` are cheap to add. Not decided against: G-070 (PLAN-1 4C) just left them out | Real friction worth a small API change | Add `+` and `~` to the mock selector engine (`parseSel` + `matches`; `SUPPORTED`), and add `nextElementSibling`/`previousElementSibling` to `MockElement`. Update the selector lists in `index.d.ts` (`simulateEvent`/`query` JSDoc), llms.txt:315 (drop `+`, `~` from "throw") and the testing guide. Mention "a comma list comes back in document order". Don't add `t.before`; `+`/`~` and sibling reads cover it. Files: `src/extra/testing.ts`, `src/index.d.ts`, `test/` (selector suite), llms.txt. Size gate: testing code is not in the kanban bundle | S | Next release (fine before the preview if a slot is free) |
| 5 | An HTTP reply goes only to the component that sent the request. Start reused the Wizard's reply names and got SYG112. Ask: address a reply to an ancestor (`ok: { parent: 'TEMPLATES' }`), or document the rule and a shared-loader pattern | By design and documented: llms.txt:179 says "The reply reaches exactly the instance that sent it", and SYG112's explanation says "delivers the reply to the sending component". What's missing: the dev SYG112 message (`checks/replies.ts:84–94`) only suggests a near name in the **same** component. SYG117 already looks for the nearest ancestor that has the entry and names it, and SYG112 doesn't. No doc gives the shared-loader pattern: one owner declares `resources: { templates }` and anyone retries with `{ invalidate: 'templates' }`, or a child asks the owner with `EVENTS: event('RETRY_TEMPLATES')` | WAI (documented). The diagnostic could point at the fix | (a) SYG112 dev message: when an ancestor (or the root) has a model entry with that name, name it and say "replies go only to the sender: send the request from <Ancestor> (`EVENTS: event(...)` from here) or handle it here". Reuse SYG117's ancestor lookup. (b) Add a sentence on the shared-loader pattern to SYG112's `fix`/explanation and next to llms.txt:179 / `guide/http.md`. (c) **Decline** `ok: { parent }`. It breaks the "exactly the sender" invariant (Collection items, two instances) that the no-request-ids story rests on | S | Next release |
| 6 | ELEMENT commands reach only the issuing component's DOM (SYG640). The Wizard had to emit `event('NAME_FIRST')` so Start could focus its field. Ask: mention that hand-off in SYG640's text and llms.txt | Code: SYG640's fix text (`checks/elementCommands.ts:106`, `explanations.js` SYG640) says "send the command from the component that renders it" but not how a child gets an **ancestor** to do it. `guide/element-commands.md:79,117` covers parent → child (`focusWithin`) and the child's own model only. llms.txt:146 has no hand-off sentence | Docs / diagnostic-text gap | Add to SYG640's `fix` (runtime + explanations.js → regenerate) and to llms.txt:146 and the guide: "an element an ancestor renders: emit `EVENTS: event('FOCUS_NAME')` (or `PARENT`) and send `ELEMENT` from the ancestor's entry". Optional (S): when the target is absent from the sender's scope but matches in the page, say "it is rendered outside <Name>'s view (in an ancestor or another component)". Files: `src/extra/diagnostics/checks/elementCommands.ts`, `sygnal-check/src/explanations.js`, `docs/.../guide/element-commands.md`, llms.txt | S | Next release (text-only parts could go before the preview) |
| 7 | `<VirtualCollection estimateSize>`: rows taller than the estimate (52 vs 71 px) leave blank space at the end while scrolling until the scroll settles. Ask: measure rows and correct the total, or warn in dev | Rows **are** measured: `measureElement` on insert (`virtual.ts:387`) and a ResizeObserver after that, applied in the **next frame** (`useAnimationFrameWithResizeObserver`, G-402; `virtual.ts:160`). Unmeasured rows below still count at the estimate, so the spacer is too short until they render. That's how TanStack's estimate model works, and Sygnal's one-frame defer adds to it. Not reproduced in a browser here, so whether Sygnal's frame lag makes it visibly worse than plain TanStack is **unverified**. The guide (`virtual-collections.md:113`) says "a good estimate keeps the scrollbar steady" but not what an underestimate looks like | Mostly WAI (estimate-based virtualization). Possible friction worth a dev diagnostic | (a) Docs: "an estimate below the real height shows blank space at the end of a fast scroll until those rows are measured: use the real height, or err high". (b) Dev hint (SYG436, free): after ~20 measured rows, a numeric `estimateSize` that is off from the median measured height by >1.3× (once per instance, with the measured median in the message). (c) A browser-tests repro (fast scroll to end, estimate 52, rows 71) comparing Sygnal with plain `@tanstack/virtual-core`, before touching the frame defer. Files: `src/extra/virtual.ts`, `src/extra/diagnostics/codes.ts`, explanations, `browser-tests/src/tests/`, the guide | Docs S, hint S, repro M | Docs + hint next release. Repro backlog |
| 8 | This machine's `sygnal:sygnal-dev` plugin is still 0.1.5 and describes 6.x timing | The repo's plugin is 0.2.1 (`editors/claude-code/.claude-plugin/plugin.json`) and its skill says "describes Sygnal 7" up front (`skills/sygnal-dev/SKILL.md:20`). The feedback file itself marks it "Local, not upstream" | Out of scope (local install) | No action. Kindo's machine runs `claude plugin marketplace update sygnal && claude plugin update sygnal@sygnal`. Backlog idea only: a plugin SessionStart check that compares the skill's major with the project's installed `sygnal` | — | No action |

Ranking: impact on users, discounted by effort. #1 is the only point where code passes every static gate and then fails
at run time. #2 caused 25/37 E2E failures in Temper's migration and is undocumented. #3–#6 are cheap docs or message
fixes that each cost an agent one wrong turn. #7 has a workaround (a correct estimate) and needs a browser repro
before any core change.

## Overlap with the parallel session

That session is changing `src/extra/form.ts`, `src/extra/router.ts`, `src/core/runtime.ts` (the DOM shorthand) and
`llms/ai.md`. **None of the actions above touch those files.** Two things to watch:

- #2's docs pattern is for routed pages (`instance={route.path}`) and might gain a line in `guide/router.md`. That's
  docs only, not `router.ts`.
- #3, #4, #5 and #6 edit `llms.txt` core lines (testing 315, HTTP 179, ELEMENT 146, Switchable 132/229). After the
  llms-context split, edit `llms.txt` and run `node scripts/build-llms.mjs`. The core's byte budget (64,500 B,
  `test/llms-txt.test.js`) applies, so keep each addition to one clause.

## Decisions for the maintainer

**Decided 2026-10-30:** the maintainer accepted all five recommendations as written below. D172 stays, with docs and the
one-page pattern now. `simulateEvent` returns a resolve-only `Promise<void>`. `ok: { parent }` is declined, and SYG112
names the ancestor instead. `+`/`~` and the sibling reads are added, with no `t.before`. SYG303 is info, raised to a
warning by `--strict`.

1. **Reopen D172 for lifetimes, not render cost?** (#2) D172 rejected a `lazy` prop because deferring the *render*
   gains nothing. Temper's problem is different: hidden pages run BOOTSTRAP and other entry side effects at mount.
   *Recommendation:* document it and the one-page keyed pattern now. Keep D172 for the preview, and revisit
   `mount="shown"` only if a second user hits it. The pattern works today at 0 B, and the router case already
   re-creates pages through `instance=`.
2. **`simulateEvent` returns a promise?** (#3) *Recommendation:* yes, for the next release, resolve-only
   (`Promise<void>`, never rejects; failures still surface through the next wait as today). It turns a doc rule
   agents miss into the natural `await`. If you'd rather not grow the API, the doc sentence alone closes the item.
3. **Reply addressing to an ancestor (`ok: { parent: 'X' }`)?** (#5) *Recommendation:* decline. Keep "a reply
   reaches exactly its sender", and make SYG112 name the ancestor that has the entry, as SYG117 does.
4. **Sibling combinators vs. a `t.before()` helper?** (#4) *Recommendation:* add `+`/`~` and
   `next/previousElementSibling` (real-DOM parity, no new concept), and no `t.before`.
5. **Strict hint for `STATE.stream` + `dropRepeats` (SYG303)?** (#1b) *Recommendation:* yes, as an info that
   `--strict` raises to a warning. The SYG302 extension (#1a) needs no decision: it's the same bug class that
   PLAN-13 X-1 already fixed for `xstream`.

## Repro notes

- Selectors / order / timing (`renderComponent` from `dist/index.esm.js`): `'.filters + .empty'` and `'~'` throw.
  `queryAll('.empty, .filters')` → `['filters', 'empty']`. `nextElementSibling` → `undefined`. `t.query('.skel')`
  right after `simulateEvent` → `null`, and after `await t.settle()` → present.
- xstream extra: Node ESM in a `"type": "module"` folder, `import dropRepeats from 'xstream/extra/dropRepeats.js'`
  → `object [ 'DropRepeatsOperator', 'default' ]`. `import { dropRepeats } from 'sygnal'` (dist ESM) → `function`.
  `node sygnal-check/bin/sygnal-check.js --strict --verbose` on the component → `0 warnings` (no info either).

## Round 3, item 9: testing a child's file input

**The point (one line).** In a test, `t.simulateEvent('.infer-file', 'change', { files: [file] })` leaves
`e.target.files` undefined. The fallback, `t.simulateAction('INFER_FILE', …)`, goes to the root (the Wizard), not to
the child (Start) that owns the action, and is dropped silently. Asks: let `simulateEvent` set `files` (and other
target props), and let `simulateAction` name a child or report an action the root doesn't have.

Checked against `claude/advanced-integration` at 2c987dc6. That commit includes the form transport change: a
JSON submit goes over fetch, and a multipart submit or `progress: true` goes over XMLHttpRequest. The repro
(`item9-repro.test.js`, kept in the session scratchpad, not committed) runs a Wizard with a Start child that has
a file input, and a `form()` with a file field, on the mock DOM and on `dom: 'real'` (jsdom):

| Case | Mock DOM | `dom: 'real'` |
|---|---|---|
| `simulateEvent(sel, 'change', { files: [f] })` (Temper's call) | `e.target.files` undefined: a top-level key the harness doesn't know is copied onto the **event** (`e.files`), not the target | undefined: the same, on a real `Event` |
| `simulateEvent(sel, 'change', { target: { files: [f] } })` | works (`init.target` is spread onto the mock target) | **silently fails**: `fire()` (`testing.ts:1072`) assigns `el.files = [f]`, jsdom's setter only takes a `FileList` and throws, and the `try {} catch {}` swallows it. The intent sees an empty `files` |
| `form()` file field: `{ target: { files } }` on `[name="avatar"]`, then submit | the File reaches `state.form.values.avatar`, the request has `multipart: { avatar: File }` and `progress: 'form.PROGRESS'`, `t.progress('HTTP', { loaded: 1, total: 2 }, 'form.PROGRESS')` gives `state.form.progress = { phase: 'upload', fraction: 0.5, … }`, and `t.respond` ends the submit (progress back to `null`) | value stays `null`, so the form sends **JSON** `{ avatar: null }` (no multipart, no progress) and `t.progress` throws "no pending HTTP request matching 'form.PROGRESS'". The file never got in, so the transport change has nothing to act on |
| `simulateAction('INFER_FILE', f)` where only the child has the entry | dropped: `api.dispatch('root', …)`, no state change, **no diagnostic** (`t.diagnostics` empty) | same |

**The form transport change doesn't affect tests.** `renderComponent`'s HTTP fake is the real `makeFetchDriver`.
A multipart or `progress` request shows up in `t.requests('HTTP')` with its `multipart` parts (the File itself),
and `t.progress` / `t.respond` drive it whichever transport a browser would use. Upload testing works end to end
on the mock DOM. The two gaps are getting the File into the input, and `simulateAction`'s scope.

**Already documented, but in one place only.** `guide/forms-reference.md:77` shows the working mock-DOM form:
`t.simulateEvent('[name="avatar"]', 'input', { target: { files: [new File(['…'], 'me.png')] } })`. The testing
guide, llms.txt (line 315 lists `{ value }`, `{ checked }`, `{ key }`, `{ data }` only) and the skill don't mention
`target` or files. The testing guide says `simulateAction` "pushes an action into the component", which doesn't
make clear that this means the rendered (root) component only.

**Classification.**
- (a) `{ files }` at the top level: **real friction worth a small API change.** `value` and `checked` are already
  shorthands for `target.*`, and `files` is the same kind of thing: the user asked for an element property.
- (b) `{ target: { files } }` on `dom: 'real'`: **still a real bug.** It's silent: the swallowed setter error leaves
  the input empty, and a form then submits JSON without the file.
- (c) `simulateAction` with an action only a child handles: **real friction worth a diagnostic change** (silent no-op;
  the same class of trap as SYG117 for `next()`), plus a small API addition.
- (d) Docs: `target` / files are missing from the testing guide and llms.txt: **docs / llms.txt gap.**

**Recommended action.**
1. **`files` shorthand** (`init.files`, like `value`/`checked`): the mock target gets `files` as a FileList-like
   array (`length`, `item(i)`, iterable). On the real DOM it's set with a real `FileList`: built through
   `DataTransfer` where it exists (browsers), else defined on the element (`Object.defineProperty(el, 'files',
   { value, configurable: true })`; jsdom has no `DataTransfer`). The same path fixes `{ target: { files } }` on the
   real DOM. More generally, a `target` key whose assignment throws should fall back to `defineProperty` instead
   of being swallowed, or fail the test naming the property. Files: `src/extra/testing.ts` (`fire()`, the mock
   target, `SimulatedEventInit` in `src/index.d.ts`), tests in `test/` (mock + jsdom, a file input in a child and
   a `form()` file field through submit, `t.progress` and `t.respond`), and one case in `browser-tests/` (real
   `FileList` via `DataTransfer`). **S.**
2. **`simulateAction` scope:** fail the test (the way an unmatched `simulateEvent` selector does, rejecting the next
   wait) when the target instance has no model entry, behavior action or built-in with that name. Name the
   components in the tree that do have it ("only Start handles 'INFER_FILE'"). Add a way to target one: a third
   argument `{ component: Start }` (the first live instance of that component; with `within` for a Collection
   item, like `simulateEvent`). The runtime API's `dispatch` already takes an instance, so this is the harness
   finding the instance by component. Files: `src/extra/testing.ts` (`simulateAction`), `src/index.d.ts`, tests,
   docs. **S–M.** Watch one compatibility point: today an unknown name is a silent no-op, so a test suite that
   relied on that would start failing. That's the intent, but it's a behaviour change: put it in the CHANGELOG.
3. **Docs:** in the testing guide's `simulateEvent` section, a "File inputs" example (`{ files: [new File(...)] }`
   after item 1) and the `form()` upload flow (`t.requests` → `multipart`, `t.progress`, `t.respond`). One clause
   in llms.txt line 315 (`{ files: [file] }` in the init list; mind the 64,500 B budget, 5 B headroom now, so trim
   something), and the skill's matching line. `simulateAction`: say it targets the rendered component, and give
   the new option. **S.**

**Priority:** items 1 and 3 before the 7.2 preview. They're small, and the real-DOM silent failure (b) is a bug
users will hit as soon as they test an upload with `dom: 'real'`. Item 2 can go into the next release if the
preview is close; otherwise ship it with them.

**Overlap:** none with open work. The form change is already merged, and nothing here touches `form.ts`. The
`files` path only feeds what `form.ts:296` already reads (`t.files`).

**Decisions for the maintainer.**
1. **`simulateAction` on a name the target doesn't handle: fail the test, or report an info diagnostic?**
   *Recommendation:* fail, like an unmatched selector. A silent no-op in a test only ever hides a mistake, and
   the message names the component that does handle it.
2. **How to target a child: `{ component: Start }` on `simulateAction`, or a separate `t.child(Start).simulateAction(…)`?**
   *Recommendation:* the option object (`{ component, within }`). It mirrors `simulateEvent`'s `within` and adds
   no new surface to the result object.
3. **Swallowed `target` assignment errors on the real DOM: fall back to `defineProperty`, or fail?**
   *Recommendation:* fall back to `defineProperty` for own data properties (files, and the read-only ones jsdom
   rejects), and fail only if that throws too. Tests then read what they set, as on the mock DOM.

**Decided (2026-10-30, the maintainer accepted all three recommendations), and implemented on `claude/temper-fixes`:**
1. `simulateAction` with a name its target doesn't handle **fails the test** (at the call when nothing is queued,
   else through the next wait), naming the rendered components that handle it. Built-ins (`INITIALIZE`, `BOOTSTRAP`,
   `DISPOSE`, `HYDRATE`) and behavior actions count as handled. CHANGELOG: a behaviour change.
2. A child is targeted with a **third argument `{ component, within }`** (a component or its name; `within` as in
   `simulateEvent`). No `t.child()`.
3. A real-DOM `target` assignment that throws falls back to **`defineProperty`**; the test fails naming the
   property only when that throws too. `files` (shorthand and `target.files`) becomes a real `FileList` via
   `DataTransfer` where it exists, else a FileList-like array with `item()`.

Three of Sygnal's own tests relied on the silent drop and were fixed: `p5-4h2-skill-rules` (a "control" test whose
`form.RESET` went to the App and never ran; it now names `AddPage`), `p3-1b-effect` (a removed `'POKE | EFFECT'`
key, so the action had no entry; now the canonical `POKE: { EFFECT }`), and `p3-g189` (an unknown name used as "an
action that sends nothing"; now a real no-op entry). The examples, the create-sygnal-app templates, the recipes and
the docs' snippets send only actions their component handles. llms.txt's core budget was raised from 64,500 B to
65,000 B for the two testing clauses (`dev-plans/research/llms-context/README.md` records it).
