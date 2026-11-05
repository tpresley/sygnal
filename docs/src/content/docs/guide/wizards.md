---
title: Wizards
description: Multi-step flows with the wizard behavior and the Outlet — a shared draft, steps that exist only while shown, a flow key, start over, a leave guard, the step in the URL, and an accessible stepper
---

:::caution[Experimental, outside semver]
`wizard()` and `<Outlet>` are experimental in Sygnal 7.2: their names, options and slice may change in any release.
:::

A wizard is one flow over several steps: a draft that the steps fill in, Back and Next, and a stepper. Declare the flow with the `wizard()` [behavior](/guide/behaviors/), and render the current step with `<Outlet>`. **Only the current step exists:**
- entering a step runs its `BOOTSTRAP`;
- leaving it runs its `DISPOSE`, and its requests, connections, timers and watches stop with it.

A [Switchable](/guide/switchable/) keeps hidden steps running instead.

The [`filter-wizard` example](https://github.com/tpresley/sygnal/tree/main/examples/filter-wizard) is a whole flow on the router: the step in the URL, a step group, the leave dialog, an outcome step, and its tests.

## The recipe

```jsx live title="NewProject.jsx"
import { wizard, Outlet } from 'sygnal'

function Name({ state }) {
  return (
    <div>
      <h2>Name the project</h2>
      <label>Name <input className="name" value={state.draft.name} /></label>
    </div>
  )
}
Name.intent = ({ DOM }) => ({ NAME: DOM.input('.name').value() })
Name.model = {
  NAME: (state, name) => ({ ...state, draft: { ...state.draft, name } }),
}

function Plan({ state }) {
  return (
    <fieldset>
      <legend><h2>Pick a plan</h2></legend>
      {['free', 'team'].map((plan) => (
        <label><input type="radio" name="plan" className="plan" value={plan} checked={state.draft.plan === plan} /> {plan}</label>
      ))}
    </fieldset>
  )
}
Plan.intent = ({ DOM }) => ({ PLAN: DOM.change('.plan').value() })
Plan.model = {
  PLAN: (state, plan) => ({ ...state, draft: { ...state.draft, plan } }),
}

function Seats({ state }) {
  return (
    <div>
      <h2>How many seats?</h2>
      <label>Seats <input type="number" className="seats" min="2" value={state.draft.seats} /></label>
    </div>
  )
}
Seats.intent = ({ DOM }) => ({ SEATS: DOM.input('.seats').value() })
Seats.model = {
  SEATS: (state, seats) => ({ ...state, draft: { ...state.draft, seats: Number(seats) } }),
}

function Review({ state }) {
  const { name, plan, seats } = state.draft
  return (
    <div>
      <h2>Review</h2>
      <p>{name}, on the {plan} plan{plan === 'team' ? ` with ${seats} seats` : ''}.</p>
    </div>
  )
}

function NewProject({ state }) {
  const w = state.wizard
  if (state.created) return <p role="status">Created {state.created}. <button type="button" className="start-over">Make another</button></p>
  return (
    <section className="new-project">
      <ol className="wizard-steps" aria-label="Progress">
        {w.steps.filter((s) => !s.skipped).map((s) => (
          <li aria-current={s.current ? 'step' : undefined} data-status={s.status}>
            {s.reachable && !s.current
              ? <button type="button" className="goto" data-step={s.name}>{s.label}</button>
              : <span>{s.label}</span>}
            {s.status === 'done' && <span className="visually-hidden"> (completed)</span>}
          </li>
        ))}
      </ol>
      <Outlet of={{ name: Name, plan: Plan, seats: Seats, review: Review }} from="wizard" />
      <p className="wizard-moves">
        <button type="button" className="back" disabled={!w.canBack}>Back</button>
        <button type="button" className="next" disabled={!w.canNext}>{w.last ? 'Create' : 'Next'}</button>
      </p>
    </section>
  )
}
NewProject.initialState = { created: '' }
NewProject.uses = {
  wizard: wizard({
    steps: {
      name: { label: 'Name', valid: (s) => s.draft.name.trim() !== '' },
      plan: { label: 'Plan' },
      seats: { label: 'Seats', when: (s) => s.draft.plan === 'team', valid: (s) => s.draft.seats >= 2 },
      review: { label: 'Review' },
    },
    draft: { name: '', plan: 'free', seats: 2 },
    next: '.next', back: '.back', goto: '.goto', reset: '.start-over',
    finish: 'CREATE',
  }),
}
NewProject.model = {
  CREATE: (state, draft) => ({ ...state, created: draft.name }),
  'wizard.RESET': (state) => ({ ...state, created: '' }),
}

export default NewProject
```

```css live
.wizard-steps { display: flex; flex-wrap: wrap; list-style: none; padding: 0; border-bottom: 1px solid var(--sl-color-gray-5); counter-reset: step; }
.wizard-steps li { counter-increment: step; display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.75rem; margin: 0 0 -1px; border-bottom: 2px solid transparent; color: var(--sl-color-gray-3); }
.wizard-steps li::before { content: counter(step); display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border: 1px solid currentColor; border-radius: 50%; font-size: 0.8rem; }
.wizard-steps [data-status="done"]::before { content: "✓"; color: var(--sl-color-text-accent); }
.wizard-steps [aria-current="step"] { color: var(--sl-color-white); font-weight: 600; border-bottom-color: var(--sl-color-accent); }
.wizard-steps [aria-current="step"]::before { background: var(--sl-color-accent-high); border-color: var(--sl-color-accent-high); color: var(--sl-color-black); }
.wizard-steps button { margin: 0; padding: 0; border: 0; background: none; color: var(--sl-color-text-accent); text-decoration: underline; text-underline-offset: 0.2em; }
.wizard-moves { display: flex; gap: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--sl-color-gray-5); }
.wizard-moves button { margin: 0; padding: 0.4rem 1rem; font-weight: 600; }
.wizard-moves .next { margin-left: auto; background: var(--sl-color-accent-high); border-color: var(--sl-color-accent-high); color: var(--sl-color-black); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
```

**The `wizard` options:**
- **`steps`:** the steps, in order. Each step can have:
  - `label`, a string or a function of the step's state and the bag (`(s, { state }) => s.bound ? 'Review and save' : 'Review'`);
  - `valid`, which gates Next and the steps after it;
  - `when`, which leaves the step out of the flow when false;
  - `visit`, the step's scratch (below);
  - `dirty`, `discard` and `dialog`, the [leave guard](#unsaved-changes) while it is the current step;
  - `group`, for [alternative steps](#alternative-steps-and-an-outcome) that share one stepper entry;
  - `outcome`, for a [final screen](#alternative-steps-and-an-outcome) after the flow.
- **`draft`:** the draft a flow starts with. A function gets the host's state.
- **`draftKey`:** the draft's name in a step's state (default `'draft'`). Use another when the steps already have a `draft` of their own: `draftKey: 'flow'` gives them `state.flow`. It can't be a component spec key (`actions`, `props`, `context`, `calculated`, ...): `WizardStepComp` would read `{ actions: Draft }` as a spec, so TypeScript rejects it.
- **The buttons:** `next`, `back`, `reset` and `goto` are selectors whose clicks move. A `goto` element names its step in `data-step`.
- **`finish`:** a host action. Next on the last step dispatches it with the draft.

**The actions** are `wizard.NEXT`, `wizard.BACK`, `wizard.GOTO` (a step name), `wizard.RESET`, `wizard.FINISH`, `wizard.DISCARD` and `wizard.STAY`. A host model entry with the same name runs after the behavior's, as for any behavior. The recipe uses that to clear `created` on `wizard.RESET`.

**A step moves the flow** by sending a `PARENT` message the wizard reads:

```jsx
Describe.model = {
  OPENED: { PARENT: () => ({ wizard: 'NEXT' }) },              // also 'BACK' and 'FINISH'
  EDIT_SOURCE: { PARENT: () => ({ wizard: 'GOTO', step: 'source' }) },
  START_OVER: { PARENT: () => ({ wizard: 'RESET' }) },         // `draft: { … }` merged over draft()
}
```

The buttons inside a step aren't the host's, so this is how a step's own Next, Back or Start over works.

## What a step sees

A step is an ordinary component. Its `state` has two parts:
- **`state.draft`** is the flow's draft, shared by every step. A step fills in the flow by writing it: `{ ...state, draft: { ...state.draft, name } }`.
- **Everything else is the step's own slice.** Its resources, a [`form`](/guide/forms/) behavior, open panels and busy flags all live there. Two steps can use the same names (two `session` resources, two forms) without colliding.

What a step's state keeps, and when:

| | Back and forth between steps | A new flow key, or Start over |
|---|---|---|
| `state.draft` | kept | made again from `draft` |
| the step's own slice | kept | made again |
| the step's `visit` fields | set again on each entry (and when the host mounts again) | set again |
| the step's running work (requests, watches, timers) | stopped on leave, started on entry | stopped, started |

- **`visit`** is a step's scratch: fields that must not survive leaving the step, such as a `creating` flag or an error. `review: { visit: { creating: false, error: null } }` sets them on every entry.
- **`initialState`:** a step with one also needs `isolatedState = true`, and starts its own slice from it.
- **Predicates:** `valid`, `when`, a function `label`, `dialog` or `visit`, and a step's `discard` get `(step, bag)`; `dirty` gets `(step, stepName, bag)`:
  - `step` is what the step sees: its `initialState`, its own slice, and the draft;
  - `bag` is what the host's view gets ([What every function gets](/guide/state/#what-every-function-gets)): its props, `context`, `uid`, and `state`, the host's state, for what the step doesn't hold (the route, a setting, a record id prop).

  `draft`, `key` and `url.from` get `(state, bag)`, `resetTo` and the wizard-level `discard` `(slice, bag)`. What the wizard watches in its intent (the key, the leave guard, the derived fields) gets the same bag, and runs again when the host's context changes, so `key: (s, { context }) => context.route?.query.session` works.

  A step can therefore be skipped because of an earlier step's answer, as the Seats step is in the recipe. The derived fields (`steps`, `canNext`, …) are updated whenever the slice or the host's state changes.
- **Types:** `wizard<Draft, State, { review: ReviewState }>` types each step's slice (`state.wizard.local.review`). A step component is a `WizardStepComp`, whose `initialState` is its own fields:
  - `WizardStepComp<ReviewState>` for a step that doesn't read the draft (its state is its own fields; it works under any wizard);
  - `WizardStepComp<DefineState, { draft: Draft }>` for one that does, naming the draft's key and type together (`{ flow: Draft }` under `draftKey: 'flow'`);
  - `WizardStepComp<ReviewState, { draft?: Draft }>` for one that only writes it, in a reducer or two: its other reducers stay `(s: ReviewState) => ReviewState`;
  - a component spec comes after, or in second place when there's no draft: `WizardStepComp<ReviewState, { actions: Actions }>`, `WizardStepComp<DefineState, { draft: Draft }, { actions: Actions }>`.

  The leave dialog's copy has a type too: `wizard<Draft, State, Local, 'draft', Copy>` makes `state.wizard.dialog` a `Copy | null`.

**A step with a form:**
1. Put the [`form`](/guide/forms/) behavior in the step's `uses`.
2. Let the step's `valid` read the form slice: `account: { valid: (s) => !!s.form?.valid }`.
3. Make the form's submit move the flow on with a `PARENT` message:

```jsx
Account.uses = { form: form(accountSchema, { values: { email: '' }, submit: 'DONE' }) }
Account.model = { DONE: { PARENT: () => ({ wizard: 'NEXT' }) } }
```

**A step seeded from its own data**, and seeded again when that data is revised: React's `key={updatedAt}` on the step. Review builds an editable spec from a proposal it loads. Going Back and returning keeps the user's edits, but a revised proposal replaces the spec, edits and all, since they were made against the old one. Watch the data's stamp, and keep the stamp the spec was built from next to it:

```jsx
Review.resources = { proposal: (state) => ({ url: `/api/sessions/${state.draft.session}/proposal` }) }
Review.intent = ({ STATE }) => ({
  SEED: STATE.watch((state) => state.proposal?.data?.updatedAt ?? null, { immediate: true }),
})
Review.model = {
  SEED: (state, stamp) => stamp == null || stamp === state.specFor
    ? ABORT
    : { ...state, spec: specFrom(state.proposal.data), specFor: stamp },
}
```

- The watch runs on entry (`immediate`) and on every change of the stamp, so the data arriving after the step mounts seeds it too.
- Back and forth with the same proposal keeps the spec: `specFor` already matches. A new flow key or Start over makes the step's slice again, so the spec is rebuilt.
- To keep some edits across a revision instead, merge them in `SEED` rather than replacing the spec.

## The flow key

A flow belongs to a record: a session, a draft being edited, a report. Name it with `key`:

| `key(state)` goes from | the flow |
|---|---|
| one key to another | starts over for the new record: `draft` and every step's slice are made again, at the first step |
| none (`null` or `undefined`) to a key | is kept, and takes the key: a key born mid-flow (step one created the session). With a `draft` function, the draft's top-level fields the user hasn't changed are filled again from `draft(state)` (a field the new route fills); the others keep what the user typed |
| a key to none | is kept with its key (a step route without the key, such as the first step's) |
| anything to `undefined` | is kept: `undefined` means "not mine" (another route of the host) |

Start over is `wizard.RESET` ([below](#start-over)), not a key change.

```js
wizard({
  steps,
  key: (state) => state.route.query.session,
  draft: (state) => ({ source: state.route.query.filter ?? null }),
})
```

- **No stale render:** until the state belongs to the new key, the outlet renders no step. A step never mounts against the old record's data.
- **A second record from inside the flow:** a step that creates another record (Back to step one, Continue, a new session) moves there with `{ wizard: 'GOTO', step: 'describe', key: newSession }`.
  - The flow starts over for the new key, straight at that step. In URL mode the wizard navigates there, past the leave guard.
  - The query starts fresh, as on any step's navigation: the route gets the key and `query`, `{ wizard: 'GOTO', step: 'analyze', key: session, query: { report } }`. A value of the current route the new flow needs goes in `query`.
  - The new flow's draft is `draft(state)` on the route it lands on, with the message's `draft` merged over it: `draft: { carried }` adds a field, `draft: { bound: undefined }` drops one.
  - While the flow has no key yet, the key is adopted and the flow kept, as for a key the route names.
- **Host state only:** `key` reads the host's state, not its context. Keep the route in the host's state (or the root's), as the [router recipe](/guide/router/#reading-the-route) does.

## Entering the wizard again

A flow kept in a parent's state outlives the wizard's page, so a reload resumes it. What an entry from another page does depends on `restart`:

- **`restart: 'outcome'`** (the default): a finished flow, on its [outcome step](#alternative-steps-and-an-outcome), starts over. A flow left mid-way resumes where it was. Leaving it with unsaved edits asked first (the leave guard), and Discard started it over.
- **`restart: 'entry'`**: every entry from another page by a link or a navigation command starts a new flow, finished or not, with the draft from `draft(state, bag)` on the route entered. The browser's Back and Forward resume it instead, the outcome included. Use it when the way in sets the flow up, such as a "door" query that seeds the draft. A reload still resumes: the marker that tells an entry from a reload isn't saved by `persist`.

An entry is the wizard's host mounting again in the same page session; `'entry'` tells a link or a command from Back and Forward with [`ROUTER.navigation()`](/guide/router/). Render the wizard's steps in one host that stays mounted across them (one `<Outlet>` page for the wizard's routes): with `'entry'`, a host that remounts on every step would start over each time.

## Start over

`reset: '.start-over'`, the `wizard.RESET` action, or a step's `{ wizard: 'RESET' }` starts the flow over: the draft, every step's slice, and the first step. When the action's data (the message's `draft`) is a plain object, it is merged over `draft(state, bag)`: pass only what the new flow adds or changes, `{ wizard: 'RESET', draft: { source: null } }`, and set a field to `undefined` to drop it.

In URL mode it then navigates to the first step's route, with no key (the route it lands on names one, or none). The new draft comes from `draft(state, bag)` on that route, once it has landed, not on the route left, and so do the first step's `visit` defaults (a `visit` function sees the landed route; a RESET's `draft` is merged over that route's draft). `resetTo` names another place:
- a router command: `resetTo: { to: 'newFilter' }`;
- or a function of the slice *being reset* and the bag, when the flow's data decides where its start over goes: `resetTo: (prev) => ({ to: 'newFilter', query: { filter: prev.draft.bound } })`.

A Start over *link* inside a step must not navigate as well: the router would push its `href` and then `resetTo`. Keep the `<a href>` (it still works as a link without the app) and prevent its default in the intent:

```jsx
StartOver.intent = ({ DOM }) => ({ RESTART: DOM.click('.start-over', { preventDefault: true }) })
StartOver.model = { RESTART: { PARENT: () => ({ wizard: 'RESET' }) } }
```

## Unsaved changes

```js
wizard({
  steps,
  dirty: (step, name, bag) => step.draft.source != null,
  confirm: '.leave-dialog', leave: '.discard', stay: '.stay',
})
```

`dirty` gets the current step's state, the step's name and the bag. A step's own `dirty` in `steps` is used instead while it is the current step: `review: { dirty: (s) => s.name !== '' }`.

**A step's own `discard`** takes the step's state and returns it, as `dirty` reads it: `review: { discard: (s) => ({ ...s, name: '' }) }`. The draft under its key in the result updates the draft. The wizard-level `discard(wizardSlice, bag)` returns the whole slice.

**The dialog's copy** can follow the step: `steps.x.dialog` (any value, or a function of the step's state and the bag), else the wizard's `dialog`, is `state.wizard.dialog`:

```js
wizard({ steps: { describe: { dialog: { title: 'Discard your reply?' } }, review: { dialog: { title: 'Discard your edits?' } } } })
```

```jsx
<dialog className="leave-dialog">
  <h2>{state.wizard.dialog?.title}</h2>
  <button type="button" className="discard">Discard</button>
  <button type="button" className="stay">Keep editing</button>
</dialog>
```

**While `dirty` is true:**
- **Navigation away from the flow is held:** a link, a router command, or the browser's back button. It uses the router's [`block`](/guide/router/#unsaved-changes), so the component needs the `ROUTER` driver.
- **Closing the tab** gets the browser's own prompt.
- **Moves inside the flow** are never held, because their values are kept. In URL mode they are navigations to a step route that are made at once:
  - Next, Back and the stepper;
  - the browser's back and forward between steps;
  - a step's own navigation to another step. A step that created the flow's record and moves on with the new key passes too, while the flow has no key yet.
- **A step that saves or drops its edits and leaves in the same action** isn't held: the guard reads `dirty` after that action's `STATE`. `SAVED: { STATE: (s) => ({ ...s, saved: true }), ROUTER: () => ({ to: 'filter', params }) }` navigates with no dialog, and so does a step's own confirmed "Leave" that clears the edits in `STATE`. No `force` is needed.

**A held navigation** goes in `state.wizard.leaving` and opens the `confirm` dialog with `showModal()`:
- **Discard** (`leave`) runs the current step's `discard`, else the wizard's `discard`, else starts the flow over. Then it makes the navigation.
- **Keep editing** (`stay`), or Escape, closes the dialog and stays.
- **A move that drops a held navigation closes the dialog.** The browser's back and forward buttons aren't stopped by a modal, so an in-flow traversal can arrive while it's open.

## Alternative steps and an outcome

**Alternative steps** fill one place in the flow: Analyze a report, or Describe it in a conversation. Give them the same `group`. Their `when` decides which applies, and the stepper shows one entry for both:

```js
wizard({
  steps: {
    source: { label: 'Source' },
    analyze: { group: 'build', when: (s) => s.draft.report != null },
    describe: { group: 'build', when: (s) => s.draft.report == null },
    review: { label: 'Review' },
    created: { outcome: true },
  },
  groups: { build: { label: 'Build the filter' } },
})
```

- `state.wizard.stepper` has one entry per group or ungrouped step: `{ name, label, status, current, reachable, steps, step }`.
  - `step` is the member that applies; its state gives the entry its status.
  - `steps` lists the members.
  - The label is the group's, else the label of the member that applies.
  - Render the stepper from `stepper`. A stepper button names the member, `data-step={e.step}`: `e.name` is the group's name, which is no step.
- `state.wizard.steps` still has one entry per step.

**An outcome step** is a final screen after the flow, such as "Created": `created: { outcome: true }`.
- **How it is entered:** by a GOTO, from any step: a step's `{ wizard: 'GOTO', step: 'created' }` when the create request succeeds.
- **The stepper while on it:** every step that applies shows `done`, `state.wizard.outcome` names it, and `canBack` and `canNext` are false. It isn't in `steps` or `stepper`, and no stepper entry gets `aria-current`.
- **No way back into the steps:** Back and a GOTO to a step are refused. In URL mode the browser's back button to a step's route is replaced with the outcome's.
- **What still works:** Start over, and leaving the flow.
- **Entering it again starts a new flow:** once the flow is on its outcome, a host that mounts on another route (New filter from the list) starts over at step one, with the draft from the route entered. A reload on the outcome's route, or Back from another page to it, shows the outcome again. Without URL binding, a host mounted again on the outcome starts over. See [Entering the wizard again](#entering-the-wizard-again).

GOV.UK's confirmation pages behave the same way: the service is done, and going back doesn't reopen it.

**Start the outcome's work in the outcome step.** A step's requests end with the step: they are aborted when it is left, and their replies go nowhere. So a step that finishes the flow and also starts more work can't do both. Take "the filter is created: start its gold-set build and show Created at once": Review's GOTO to `created` would abort the build it just sent.
1. Review puts what the work needs in the draft and moves on.
2. Created starts the work in its `BOOTSTRAP`, from the draft.
3. Created clears the flag, so a host mounted again doesn't start it twice.

The build's reply and its failure then reach Created, which shows them.

```jsx
Review.model = {
  CREATED: { STATE: (s, filter) => ({ ...s, draft: { ...s.draft, created: { id: filter.id, startBuild: true } } }),
             PARENT: () => ({ wizard: 'GOTO', step: 'created' }) },
}

Created.model = {
  BOOTSTRAP: {
    STATE: (s) => s.draft.created?.startBuild ? { ...s, draft: { ...s.draft, created: { ...s.draft.created, startBuild: false } } } : s,
    // (the other sinks get the state STATE committed: the flag is read from the state before)
    HTTP: (s, data, next, { previousState: p }) => p.draft.created?.startBuild ? { url: `/api/filters/${p.draft.created.id}/gold-set`, method: 'POST', ok: 'BUILT', error: 'BUILD_FAILED' } : ABORT,
  },
  BUILT: (s) => ({ ...s, build: 'done' }),
  BUILD_FAILED: (s, e) => ({ ...s, build: 'failed', error: e.status }),
}
```

## The step in the URL

```js
// routes.js
export const router = makeRouter({ routes: { home: '/', newFilter: '/filters/new/:step', notFound: '*' } })

// NewFilter.jsx
NewFilter.uses = {
  wizard: wizard({
    steps,
    key: (state) => state.route.query.session,
    url: { route: 'newFilter', param: 'step', key: 'session' },
  }),
}
```

**With `url`, the step follows the route:**
- the route `newFilter` with `step` naming a step enters it;
- Back, Next and the stepper navigate, and the browser's back and forward buttons move between steps;
- the flow key goes in the query string (`/filters/new/review?session=…`);
- a link to a step the user can't reach yet is replaced (`replace`) with the first incomplete step before it, as GOV.UK and React Hook Form wizards send the user back:
  - when an earlier step isn't valid, that step;
  - when the step itself is skipped by `when`, the last step before it that isn't.

**A flow kept in a parent's state outlives the page.** Leaving the wizard mid-way and coming back finds the same flow, on the same step. A finished flow, on its outcome step, starts over; `restart: 'entry'` starts every entry over ([Entering the wizard again](#entering-the-wizard-again)).

**Where the route comes from:** the behavior reads it from the host's `state.route`. `url.from` names another place, or maps a route of its own onto the step route. For a first step at `/filters/new`: `from: (state) => state.route.name === 'newFilter' ? { ...state.route, name: 'newFilterStep', params: { step: 'define' } } : state.route`. A navigation the user attempts goes through `from` too, with the attempted route as the state's `route`, to tell whether it stays in the flow.

## Accessibility

There is no WAI-ARIA stepper pattern. Sygnal follows the W3C's multi-page forms tutorial and GOV.UK's question pages:
- **Render the stepper as an ordered list**, with [`aria-current="step"`](https://www.w3.org/TR/wai-aria-1.2/#aria-current) on the current step.
- **Make only the steps the user can go to buttons**, and give the others a status in visually hidden text ("completed").
- **Name the step in its heading.**
- **Focus:** after a step change, the outlet moves focus to the new step's `[data-wizard-focus]` element, else its first `h1`, `h2` or `h3` (with `tabindex="-1"` added), so a screen reader announces the new step.
  - The first step shown doesn't take focus.
  - `focus="…"` names other targets, and `focus={false}` turns it off.
  - In URL mode the router also moves focus after a navigation: put `data-router-focus` on the step's heading, or give the router `focus: '[data-wizard-focus],[data-router-focus],main h1,h1'`.

Zag, MUI and the Angular CDK render steppers as tabs (`role="tab"`). That pattern fits when every panel exists and can be visited in any order; a wizard's steps don't.

## An app's pages

The same outlet renders an app's pages one at a time. Give it the page's name and its identity, the visit:

```jsx
function App({ state }) {
  return (
    <main>
      <Outlet of={PAGES} current={pageFor(state.route)} identity={pageIdentity(state.route)} fallback={NotFound} />
    </main>
  )
}

// your own mapping: several routes to one page, a page's identity from its params and the query keys that matter
const pageFor = (route) => route.name.startsWith('admin') ? 'admin' : route.name
const pageIdentity = (route) => `${pageFor(route)}:${route.path}?${route.query.session ?? ''}`
```

- **A new identity makes a new page instance:** the old one is disposed, the new one starts.
- **Another `current` with the same identity** is a new page too (another component).
- **`fallback`** renders for a name `of` doesn't have, such as a page not ported yet.
- **Other props** pass through to the page.
- **`state`** binds every page, or each page its own with a map from page names to bindings: `state={{ admin: 'pages.admin', report: byId('reports', id) }}`. Pages not in the map share the owner's state, as with [Switchable's per-page state](/guide/switchable/#per-page-state).
- **Focus:** `focus={false}` leaves focus to the router.

It is the keyed page of the [router recipe](/guide/router/#reading-the-route), as a tag.

**Route mode** is the short form for a route table whose names are the pages, with no mapping of its own: `<Outlet of={{ home: Home, task: TaskPage, notFound: NotFound }} route={state.route} query={['session']} />`.
- Its identity is the route name, its path, and the `query` keys named.
- Changing other query keys (a sort order) keeps the page.

## Testing

A wizard is tested like any component:
- Click Next with `t.simulateEvent('.next', 'click')`, or dispatch `t.simulateAction('wizard.NEXT')`. A step's `{ wizard: 'NEXT' }` message moves it too.
- Read `t.state.wizard` (`step`, `draft`, `local`, `steps`).
- In URL mode pass the router: `renderComponent(NewFilter, { router, url: '/filters/new/source?session=a' })`. Then `t.navigate` and `t.back` move between steps.
- A reload: render the host again with the slice as `persist` saves it, `JSON.parse(JSON.stringify(t.state.flow))`. A slice copied with a spread (`{ ...t.state.flow }`) keeps the marker that tells an entry from a reload, so with `restart: 'entry'` it starts over as an entry (after a `t.navigate`) instead of resuming.
- A step alone: render the step, and its wizard messages are in `t.sent('PARENT')` (or `t.sinkValues('PARENT')`): `expect(t.sent('PARENT')).toEqual([{ wizard: 'NEXT' }])`.

## Diagnostics

- [SYG455](/reference/errors/#syg455): `<Outlet from>` names no `wizard()` in the component's `uses`.
- [SYG456](/reference/errors/#syg456): the outlet has no component in `of` (and no `fallback`) for the current step or route.
- [SYG457](/reference/errors/#syg457): an `of` key that is no step of the wizard (`sygnal-check` only).

`sygnal-check` reports SYG455 and SYG456 before the app runs too, when `uses`, `steps` and `of` are object literals.
