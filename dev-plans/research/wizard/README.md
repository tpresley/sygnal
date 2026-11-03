# A wizard / flow control and a page outlet

**Status:** spike, 2026-11-02 (branch `claude/wizard-spike-c983ac`, from `claude/main-review-fixes`). Candidate for the Sift stress test; every public name below is a proposal for the coordinator / maintainer.

## 1. Why

Three projects hand-built wizards on `<Switchable>`: Sift (the Kindo console port, 7.2.0-preview.2), plus two earlier ones. Switchable creates every page at mount and keeps the hidden ones running, which caused three kinds of bug:
- hidden steps sent requests;
- resources declared under the same name collided;
- flow state needed hand-rolled resets.

The docs now say: route pages are rendered one at a time, keyed by the visit, and Switchable is for tabs and panels on one page. This note designs the piece that is still missing, which is a declared multi-step flow.

### What Sift built by hand

Source: the `frontend/src/sygnal/wizard/` folder on the `sygnal-a3d-3` worktree, as summarised by a survey of the port.
- **No wizard host.** Each step is a route page (`/filters/new`, `/filters/new/:step`) mounted as `<Step key={pageIdentity(route)} state="wizard" />`. Every step shares one slice, `wizard`.
- **Two kinds of field in that slice, by comment only:**
  - FLOW fields (the draft) survive Back.
  - VISIT fields (busy flags, errors, `leaving`, an open dialog) are reset by each step's `BOOTSTRAP` and cleared in `DISPOSE`.
- **Four flow-key stamps:**
  - `reviewFor`: the session, which resets the review edits.
  - `reviewSpecFor`: `session@updated_at`, which reseeds the spec editor.
  - `stageDraftsAt`: the editor slices.
  - `defineFor` / `analyzeFor`.
  - Reads before `BOOTSTRAP` also go through the stamp, so that session A's Created page doesn't flash for session B. Async seeding needs `STATE.watch(stamp, { immediate: true })`.
- **The same leave guard repeated per step:** a `GUARD` watch on a dirty selector, then `{ block }`, then `CONFIRM_LEAVE` storing `proceed` in `leaving`, then a `ConfirmDialog`, then `CONFIRMED` replaying `{ ...leaving, block: false }`. An in-flow navigation needs `force` and must re-arm the block inline, because the dirty selector didn't change.
- **Resource names prefixed by step** (`describeSession`, `reviewSession`, `analyzeSession`, `reviewIntegrations`). All the steps write into the one slice, and a hidden or leaving step's late result must not overwrite the shown one's (review BL-2).
- **The stepper** is a pure `<ol aria-label="Progress">` with `aria-current="step"` and visually hidden "(done)". The step list is not linear: step 2 has two variants, the last step is optional or skippable, and "Created" is an outcome rather than a route.

## 2. Requirements

| # | Requirement | Where it comes from |
|---|---|---|
| R1 | A flow-scoped draft survives step changes (Back keeps values). Step scratch resets when the step is entered | Sift FLOW / VISIT |
| R2 | Only the current step is alive. INITIALIZE/BOOTSTRAP run on entry and DISPOSE on leave. Leaving aborts in-flight requests, closes connections and stops watches and timers | Switchable bugs |
| R3 | A flow key (record, session or report id): a change re-creates the flow state. Each step's slice is scoped to it | the four stamps |
| R4 | Start over | Sift `startOver` |
| R5 | Per-step names that can't collide (resources) | BL-2 |
| R6 | A declarative leave guard: `dirty(…)` plus a discard hook, with confirm / Discard built in, on the router's `block` | GUARD/CONFIRM_LEAVE/CONFIRMED |
| R7 | Optional URL binding of the step and the flow key. Back / Next. Stepper states (current / done / visited / blocked). Per-step `valid` | Sift routes and stepper |
| R8 | An accessible stepper, and focus on a step change | a11y |
| R9 | One mechanism shared with a route outlet: only the current page alive, identity = route name + params + chosen query keys, a leave guard | Sift finding 1 |
| R10 | Stay out of `src/core/`, and cost 0 B for an app that doesn't use it | size gate |

## 3. Prior art

**React Hook Form's multi-step recipe:**
- one form store (context, or a zustand/little-state-machine store) holds every step's values;
- each step is a route or a conditionally rendered component with its own `useForm({ defaultValues: store })`, writing to the store on submit before navigating;
- unmounted steps are gone, and their values live in the store. → *Flow draft in a store above the steps; steps mount one at a time.*

**Formik's wizard example:**
- one `<Formik>` around a `Wizard` that renders `React.Children.toArray(children)[stepNumber]`, so only the current step is mounted;
- each `WizardStep` has its own `validationSchema` and `onSubmit`;
- Next = submit the step (validate, then advance); the last step submits the whole form;
- the snapshot of values is kept in the wizard, so Back keeps them. → *Per-step validity gates Next; values are flow-scoped.*

**XState flows:**
- a wizard is a state machine: each step is a state with `NEXT` / `BACK` transitions guarded by `can*`;
- `context` is the draft;
- entering a step runs `entry` actions;
- `invoke`d actors (requests) are stopped when the state is exited, which is exactly R2;
- a "restart" is a transition to the initial state with `assign(initialContext)`;
- history states give "Back to where you were". → *Entry/exit lifetimes, guarded transitions, step-local invokes.*

**Steppers** (each read from source, 2026-11-02):
- **Zag.js `steps`**, which Chakra v3 and Ark build on:
  - the list is `role="tablist"`;
  - each trigger is `role="tab"` with `aria-selected`, `aria-current="step"` on the current one and `aria-controls`;
  - content is `role="tabpanel"`, and all panels exist but are `hidden`;
  - linear mode makes only the current trigger tabbable;
  - no focus management.
- **Angular CDK stepper:**
  - the step header is `role="tab"` and a `FocusableOption` (arrow keys through a FocusKeyManager);
  - Material wraps the headers in a `tablist`.
- **MUI `StepButton`:** `role="tab"`, `aria-selected`, `aria-posinset` / `aria-setsize`, roving tabindex, no `aria-current`. A plain `Step` (non-clickable) has no role.
- **React Aria / React Spectrum** have no stepper.
- **WAI-ARIA** has no stepper pattern. `aria-current="step"` is defined for "the current step within a process". The W3C WAI multi-page forms tutorial and GOV.UK's question pages:
  - show progress as text ("Step 2 of 4") and as an ordered list with `aria-current="step"`;
  - put the step in the page `<title>` / heading;
  - move focus to the new step's heading after a step change, so a screen reader announces it.

**What these mean for us:**
- The tabs pattern fits when all panels exist and can be visited freely (Zag hides panels). In our wizard only the current step exists (R2), and steps are reached by Next/Back or by clicking a visited step.
- The **recommendation** is the W3C / GOV.UK shape:
  - an `<ol>` with `aria-current="step"`;
  - steps the user can go back to rendered as `<button>`s (or links in URL mode);
  - the others as text, with a visually hidden status ("completed", "not available yet");
  - focus moved to the new step's heading on a step change (`[data-wizard-focus]`, else its first `h1`/`h2`/`h3`, with `tabindex="-1"` added). The router already does this for page changes.
- A team that wants the tabs pattern can render it from the same state.

## 4. The shared mechanism: one outlet

A page outlet and a wizard outlet both:
- render **one** child: the current entry of a map of components;
- key it by an **identity**, so a new identity disposes the old instance and mounts a new one (R2);
- optionally bind its state;
- optionally move focus after an identity change.

That is the documented keyed-page pattern, `<Page key={…} />`, made declarative.

**Implementation:**
- An `Outlet` marker (`preventInstantiation`, `componentName: 'outlet'`). Its `$reg` registers a `pres.outlet` template rewrite on first use, as widgets do.
- During the owner's reconcile walk, the rewrite turns the marker into an ordinary component vnode: `createElement(Current, { key: identity, state: binding, ...props })`.
- The core then treats it like any keyed tag child:
  - the step is a child **of the host**, so `CHILD.select(Step)` in the host still works;
  - its `PARENT` reaches the host;
  - its DOM is the host's isolated child DOM.
- No core change, and 0 B unless `Outlet` is imported.
- A wrapper element (`<div data-outlet>`) carries the hook that moves focus when the identity changes; it is not the first mount.

**Two modes of the one marker:**
- **Route mode:** `<Outlet of={PAGES} route={state.route} query={['session']} />`. Here current = `route.name`, and identity = `name:path?session=…`. This is the router outlet Sift asked for. It is built and tested in this spike, small as it is, to keep the mechanism honest.
- **Wizard mode:** `<Outlet of={STEPS} from="wizard" />` reads the `wizard` behavior's slice from the host's state:
  - current = `slice.step`;
  - identity = `key:step:visit`;
  - binding = a lens onto the step's own slice plus the shared draft (§5).

**Not in this spike:**
- route-mode keep-alive;
- a route-mode leave guard (a `guard` prop taking the same `dirty` / discard shape). Its design is the wizard's: block, held `proceed`, confirm, replay.

## 5. API shapes considered

### Shape A: a behavior plus an outlet, with per-step slices (recommended)

```jsx
import { wizard, Outlet } from 'sygnal'

const flow = wizard({
  steps: {
    source:   { label: 'Source',   valid: (s) => !!s.draft.source },
    describe: { label: 'Describe', visit: { busy: false, error: null } },
    review:   { label: 'Review',   visit: { creating: false }, when: (s) => !!s.draft.source },
  },
  draft: (state) => ({ source: state.route.query.filter ?? null }),  // or an object
  key: (state) => state.route.query.session ?? null,                 // the flow key
  dirty: (wiz) => wiz.draft.source != null,                          // the leave guard
  next: '.next', back: '.back', reset: '.start-over', goto: '.wizard-step',
  confirm: '.leave-dialog', leave: '.leave', stay: '.stay',
  url: { route: 'newFilterStep', param: 'step', key: 'session' },    // optional
})

NewFilter.uses = { wizard: flow }

function NewFilter({ state }) {
  const w = state.wizard
  return (
    <section>
      <ol className="wizard-steps" aria-label="Progress">
        {w.steps.map((s) => (
          <li aria-current={s.current ? 'step' : undefined}>
            {s.reachable && !s.current
              ? <button className="wizard-step" data-step={s.name}>{s.label}</button>
              : <span>{s.label}</span>}
            {s.status === 'done' && <span className="visually-hidden"> (completed)</span>}
          </li>
        ))}
      </ol>
      <Outlet of={{ source: Source, describe: Describe, review: Review }} from="wizard" />
      <button className="back" disabled={!w.canBack}>Back</button>
      <button className="next" disabled={!w.canNext}>Next</button>
      <dialog className="leave-dialog">… <button className="leave">Discard</button><button className="stay">Stay</button></dialog>
    </section>
  )
}

// a step: its own slice (kept across Back, re-created with the flow key) plus the shared draft
function Review({ state }) { … state.draft.source … state.creating … }
Review.resources = { session: (s, { route }) => `/api/sessions/${route.query.session}` }   // state.session: the review step's own
```

**The slice** `state.wizard` holds:
- `step`, `key` (the flow key it belongs to), `visit` (counts entries), `visited`, `draft`;
- `local` (each step's own slice, by name);
- `leaving` (the held navigation while the confirm is open).

**Calculated fields:**
- `steps`, one entry per step: `{ name, label, index, status, current, valid, visited, reachable, skipped }`, where status is `current | done | visited | upcoming | blocked | skipped`;
- `index`, `count`, `first`, `last`, `canBack`, `canNext`.

**Actions:**
- `wizard.NEXT`: the next step not skipped, if the current one is `valid`. On the last step it dispatches the `finish` option's host action.
- `wizard.BACK`.
- `wizard.GOTO`: a name, or a click on `goto` with `data-step`; only to a reachable step.
- `wizard.RESET`: start over.
- `wizard.LEAVE`: the router's block reply.
- `wizard.DISCARD`: the `leave` button.
- `wizard.STAY`.
- Internal: `wizard.KEY` (the flow key changed), `wizard.ROUTE` (URL mode: the step from the route) and `wizard.GUARD` (dirty changed).

**What a step sees:**
- `state` = its own slice `local[name]`, with `draft` = the shared draft. The lens writes `draft` back to the flow's draft and everything else to the step's own slice.
- Its resources, its `form` behavior's slice and its scratch are therefore per step (R5).
- Its own slice survives Back (R1). A step's `visit` defaults are written into it on every entry, so the scratch starts over (R1).
- A flow-key change or a reset re-creates `draft` and `local` (R3, R4). The outlet renders nothing while `slice.key` differs from `key(state)`, so a step never mounts or renders against the old record's data. This replaces "reads go through the stamp".

**Pros:**
- Each requirement maps to one declared option.
- The step is an ordinary component; R2 comes from keying, not from any new lifetime rule.
- Names can't collide.
- The stepper is state (`w.steps`), so any markup works.

**Cons:**
- The step's state shape is new: own fields plus `draft`.
- A step can't bind elsewhere through the outlet; it can still read context.
- `draft` is a reserved key in a step's state.

### Shape B: one shared slice, with declared visit fields (Sift's shape, made declarative)

Every step is bound to the same `wizard.draft`. Each step's `visit` keys are reset on entry, and the flow key re-creates the draft.

**Pros:** closest to what Sift has, so its steps port nearly as is; no lens.

**Cons:**
- Two steps' resources or behaviors with the same name still share one key (R5 not met: Sift's prefixes stay).
- One step's leftover scratch is visible to the next.
- "Which fields are visit fields" is a list to keep in sync with the code.

### Shape C: a `<Wizard>` host component (Formik / Zag style)

```jsx
<Wizard key={sessionId} draft={…} onFinish="CREATE">
  <Wizard.Step name="source" component={Source} valid={…} />
  …
</Wizard>
```

**Pros:** familiar to React users; everything is in the view.

**Cons:**
- A component (or core host) with its own state and lifetime, so it is new core surface (R10).
- The step list and its predicates move into the view, which Sygnal keeps free of logic.
- The host can't read or write the wizard's state through its own model (Back from an EFFECT, or a guard depending on host state) without new plumbing.
- The URL binding needs the router actions on the component.
- It doesn't share a mechanism with a route outlet.

**Recommendation: Shape A.** Shape B's reset-on-entry is available inside A through `visit`, and Sift can migrate step by step:
1. Bind a step's old fields under `draft`.
2. Move its VISIT fields to `visit`.
3. Drop the stamp fields and the prefixes.

## 6. Details of the candidate

**Flow key (R3):**
- `key(hostState)` is watched on the host's `STATE` (immediate). A different key re-creates the slice: `draft` from the `draft` option (a function gets the host state), `local` empty, the step the first one (or the URL's), and `visit` + 1.
- The key reads host state only; behavior intents don't see context. A page whose route is in context, not in its state, needs the root to provide it in state, or the route copied in. **Open question Q6.**

**URL binding (R7):**
- With `url: { route, param, key? }`, the step comes from the route: `from(hostState)`, default `state.route`. A route with that name and a param naming a step enters it.
- `NEXT` / `BACK` / `GOTO` / `RESET` send `ROUTER` commands `{ to: route, params: { [param]: step }, query: { [key]: flowKey } }` instead of changing `step`. The step changes when the ROUTE arrives back.
- A deep link to a step that isn't reachable (an earlier step not valid) is replaced (`replace: true`) with the furthest reachable step.
- Back/forward in the browser move through the steps.

**Leave guard (R6):**
- While `dirty(slice, step)` is true, the host holds `{ block: 'wizard.LEAVE' }`; when it turns false, `{ block: false }`.
- An attempted navigation to a route *inside the flow* (URL mode: the same route and flow key) is made at once, re-arming the block in the same command (`{ ...proceed, block: 'wizard.LEAVE' }`). Next/Back are not guarded: values survive them.
- Any other navigation is held in `leaving`. The `confirm` dialog (if given) is opened with `ELEMENT: { showModal }`.
- `DISCARD`:
  1. runs `discard(slice, hostState)`, which by default starts the flow over;
  2. closes the dialog;
  3. sends `{ ...leaving, block: false }`.
- `STAY` clears `leaving` and closes the dialog.
- While blocked, closing or reloading the tab gets the browser's prompt (the router's `beforeunload`).

**Focus (R8):** after an identity change that isn't the first mount, the outlet focuses the step's `[data-wizard-focus]`, else its first `h1, h2, h3`, adding `tabindex="-1"` when needed. `focus={false}` turns this off, and `focus="…"` picks other targets.
- In URL mode the router focuses after a push too (its own selector list). Put `data-router-focus` on the step heading, or `data-wizard-focus` and give the router `focus: '[data-wizard-focus],[data-router-focus],main h1,h1'`. **Open question Q7.**

**Lifetimes (R2):** these are those of a keyed child:
- the old step is disposed (DISPOSE, aborted requests, closed connections, stopped timers and watches);
- the new one gets INITIALIZE and BOOTSTRAP.

**Known core issue:** a leaving keyed child gets the new state once before it is disposed, so a `STATE.watch` in it may fire and run its sinks. The fix is landing on `claude/main-review-fixes`. Until then a step's watch can see the next step's state once (its requests are aborted with it).

## 7. Open API questions (for the maintainer, through the coordinator)

See the summary sent to the coordinator; the same list, with the recommendation first:
- **Q1 Names:**
  - `wizard()` + `Outlet` (recommended)
  - `flow()` / `steps()` + `StepOutlet` / `RouteOutlet`
- **Q2 Export:**
  - main `sygnal` export, tree-shaken like `form` / `selection` (recommended, 0 B when unused)
  - a `sygnal/wizard` subpath
- **Q3 Step state:**
  - per-step slice + `draft` (Shape A, recommended)
  - one shared slice + `visit` keys (Shape B)
- **Q4** The reserved key name in a step's state:
  - `draft` (recommended)
  - `flow`
- **Q5** `dirty` / `valid` / `when` arguments:
  - `dirty(wizardSlice, step)`; `valid(stepState)` and `when(stepState)`, where stepState is what the step sees (recommended)
  - the host state for all of them
- **Q6** The flow key from host state only (recommended for now), or also from context (needs the intent to see context, a core change).
- **Q7** Focus in URL mode:
  - the outlet's own focus, with the router configured to leave the step to it (recommended)
  - the router's
- **Q8** Stepper markup:
  - state only (`w.steps`), with the docs showing the `<ol aria-current="step">` pattern (recommended)
  - a `WizardSteps` view helper
- **Q9** Non-linear steps (Sift's step-2 variants, a skippable last step, a "Created" outcome):
  - `when` + `finish` (done here)
  - variants as separate steps sharing a label: the label decides what the stepper shows (later, if Sift needs it)

## 8. The Sift stress test and the second pass (2026-11-02)

**The report:** Sift ported its new-filter wizard onto the candidate. The full report is `/Users/troy/kindo-sift/.claude/worktrees/modest-morse-1a9367/dev-plans/sygnal-wizard-control-spike.md`, on Sift's branch `sygnal-wizard-spike`.
- **Verdict:** the structure is better and the net is −76 lines, but it isn't an improvement yet.
- **Why:** in Sift's wizard the moves come from async step results, and the flow key (the copilot session) is born at the end of step one.

**Bugs fixed (no API change):**
- **Bug 2:** `visit` is applied again when the host mounts (MOUNT), not only on an entry.
- **Bug 3 (router):**
  - A navigation sent while a blocked traversal's undo is pending is held, and made when the undo lands. Chromium drops a second `history.go()` in the same task.
  - `force` became `forceTo`, the target entry: only a pop that lands there skips the blocks.
  - The bug is on `main` too, for any blocker that answers a back/forward synchronously.
  - renderComponent's fake history now drops a `go()` while one is pending, as Chromium does.
  - A real-browser test passes on 3 engines.
- **Bug 4:** a move, route, key or reset that drops a held leave closes the dialog.
- **Bug 5:** `inFlow` maps the attempted route through `url.from`.
- **Types and checker:**
  - LOCAL (`wizard<DRAFT, HOST, LOCAL, DK>`) and `WizardStepComp`;
  - sygnal-check reports SYG455 and SYG456 statically, and SYG457 for an `of` key that is no step.

**API decided by the maintainer, and built:**
1. **The flow key:**
   - Only a change from one key to another starts the flow over.
   - None to a value is adopted, keeping the draft and the step slices.
   - None (`null`, or `undefined`: "not mine") keeps the flow and its key.
   - In URL mode, a navigation to a step route is in the flow when it is for the flow's key, for no key, or for any key while the flow has none yet. That covers Sift's "Define creates the session and moves to Describe" with no dialog: it is a test.
   - It is route-based: the router's attempt doesn't say which component sent the navigation, so "sent by a step" can't be told apart from a link with the same target.
2. **Predicates and the leave guard:**
   - `valid`, `when`, `dirty` and a function `label` get `(step, state)`: the step's view (its `initialState` merged in, registered by the outlet) and the host state.
   - `dirty` and `discard` can also be set per step.
   - The derived fields are no longer behavior `calculated` fields (those see only the slice). A SYNC action writes them whenever the slice or the host state changes.
3. **`draftKey`:** the draft's name in a step's state (default `'draft'`).
4. **Additions:**
   - a function `label`;
   - steps send `{ wizard: 'NEXT' | 'BACK' | 'GOTO' | 'RESET' | 'FINISH' }` as PARENT messages (the outlet registers each step component with the wizard, which listens to its CHILD stream);
   - `resetTo`;
   - the Outlet's `fallback`;
   - plain mode (`current` + `identity`) documented as an app's root outlet.
   - The outlet's identity is now `step:visit`, so an adopted key doesn't remount the step.

**Not decided, so not built:** step groups and variants, an outcome step, and a per-step dialog copy hook.

## 9. The third pass (Sift's second report, 2026-11-03)

**Sift's second report** is `dev-plans/sygnal-wizard-control-spike-2.md` in the Sift worktree. Its verdict: the wizard beats the hand-built version (−113 lines), and bugs 1–5 are verified in a real browser.

**Fixes:**
- **A1:** a route to a step that can't be reached goes back to the first incomplete step before it, never past it:
  - when an earlier step isn't valid, that step;
  - when the target is skipped by `when`, the last step before it that isn't skipped.

  This is what GOV.UK and React Hook Form wizards do.
- **B:** MOUNT writes the derived fields into a seeded or persisted slice before the first patch. A sub-component host's very first view call still sees a parent-seeded slice as it is. A full fix needs a core read-time hook (`fromShim` carrying a normalizer); it is with the maintainer, since it costs core bytes.
- **C:** `local` is typed `Partial`, and the predicates' view as the full OWN.
- **sygnal-check:** SYG456/457 follow `of={CONST}`.
- **The guide:** a Start over link inside a step needs `preventDefault`.

**Decided by the maintainer, and built:**
- **GOTO with a key:** a step's PARENT `{ wizard: 'GOTO', step, key }`. The flow starts over for that key at that step (or adopts the key while it has none); in URL mode it navigates there with `force`, since it is the wizard's own move.
- **`resetTo(previousSlice, state)`**.
- **A step's own `discard(stepView, state) => stepState`.** A draft under the draft key in the result updates the draft.
- **Groups:**
  - a per-step `group`, plus `groups: { name: { label } }`;
  - a derived `stepper`, with one entry per group or ungrouped step: `{ name, label, status, current, reachable, valid, visited, skipped, index, steps, step }`;
  - the member that applies (the current one, else the first not skipped) gives the entry its state.
- **Outcome steps:** `outcome: true`.
  - They are not in `steps`, `stepper` or the count, and are entered by GOTO only.
  - While on one, every step that applies is `done`, `canBack` and `canNext` are false, and `state.wizard.outcome` names it.
  - Back and a GOTO to a regular step are refused. In URL mode a route back into the steps is replaced with the outcome's route.
  - A deep link to an outcome that isn't current goes to the first incomplete step.
  - Prior art: GOV.UK confirmation pages, and RHF / Formik result steps.
- **Dialog copy:** `steps.x.dialog`, else the wizard's `dialog` (a value, or `(step, state) => value`), becomes the derived `dialog`.
- **The Outlet's per-page `state` map** (plain and route modes), as Switchable's PLAN-13 F-3. The JSX types keep the Outlet's own `state` through a brand checked in `JSX.LibraryManagedAttributes`.

**Pending with the maintainer:** A2 (the draft on key adoption, a proposed `initial` rule) and the full fix for B.
