---
title: Wizards
description: Multi-step flows with the wizard behavior and the Outlet — a shared draft, steps that exist only while shown, a flow key, start over, a leave guard, the step in the URL, and an accessible stepper
---

:::caution[Experimental, outside semver]
`wizard()` and `<Outlet>` are a 7.2 dev preview. Their names, options and slice may still change.
:::

A wizard is one flow over several steps: a draft that the steps fill in, Back and Next, and a stepper. Declare the flow with the `wizard()` [behavior](/guide/behaviors/), and render the current step with `<Outlet>`. **Only the current step exists:**
- entering a step runs its `BOOTSTRAP`;
- leaving it runs its `DISPOSE`, and its requests, connections, timers and watches stop with it.

A [Switchable](/guide/switchable/) keeps hidden steps running instead.

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
          <li aria-current={s.current ? 'step' : undefined}>
            {s.reachable && !s.current
              ? <button type="button" className="goto" data-step={s.name}>{s.label}</button>
              : <span>{s.label}</span>}
            {s.status === 'done' && <span className="visually-hidden"> (completed)</span>}
          </li>
        ))}
      </ol>
      <Outlet of={{ name: Name, plan: Plan, seats: Seats, review: Review }} from="wizard" />
      <p>
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
.wizard-steps { display: flex; gap: 1rem; list-style: none; padding: 0; }
.wizard-steps [aria-current="step"] { font-weight: bold; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
```

**The `wizard` options:**
- **`steps`:** the steps, in order. Each step can have:
  - `label`, a string or a function of the step's state and the host's state (`(s, state) => s.bound ? 'Review and save' : 'Review'`);
  - `valid`, which gates Next and the steps after it;
  - `when`, which leaves the step out of the flow when false;
  - `visit`, the step's scratch (below);
  - `dirty` and `discard`, the [leave guard](#unsaved-changes) while it is the current step.
- **`draft`:** the draft a flow starts with. A function gets the host's state.
- **`draftKey`:** the draft's name in a step's state (default `'draft'`). Use another when the steps already have a `draft` of their own: `draftKey: 'flow'` gives them `state.flow`.
- **The buttons:** `next`, `back`, `reset` and `goto` are selectors whose clicks move. A `goto` element names its step in `data-step`.
- **`finish`:** a host action. Next on the last step dispatches it with the draft.

**The actions** are `wizard.NEXT`, `wizard.BACK`, `wizard.GOTO` (a step name), `wizard.RESET`, `wizard.FINISH`, `wizard.DISCARD` and `wizard.STAY`. A host model entry with the same name runs after the behavior's, as for any behavior. The recipe uses that to clear `created` on `wizard.RESET`.

**A step moves the flow** by sending a `PARENT` message the wizard reads:

```jsx
Describe.model = {
  OPENED: { PARENT: () => ({ wizard: 'NEXT' }) },              // also 'BACK' and 'FINISH'
  EDIT_SOURCE: { PARENT: () => ({ wizard: 'GOTO', step: 'source' }) },
  START_OVER: { PARENT: () => ({ wizard: 'RESET' }) },         // `draft: { … }` starts with that draft
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
- **Predicates:** `valid`, `when`, `dirty` and a function `label` get `(step, state)`:
  - `step` is what the step sees: its `initialState`, its own slice, and the draft;
  - `state` is the host's state, for what the step doesn't hold (the route, a setting).

  A step can therefore be skipped because of an earlier step's answer, as the Seats step is in the recipe. The derived fields (`steps`, `canNext`, …) are updated whenever the slice or the host's state changes.
- **Types:** `wizard<Draft, State, { review: ReviewState }>` types each step's slice (`state.wizard.local.review`), and `WizardStepComp<ReviewState, Draft>` types a step component, whose `initialState` is its own slice without the draft.

**A step with a form:**
1. Put the [`form`](/guide/forms/) behavior in the step's `uses`.
2. Let the step's `valid` read the form slice: `account: { valid: (s) => !!s.form?.valid }`.
3. Make the form's submit move the flow on with a `PARENT` message:

```jsx
Account.uses = { form: form(accountSchema, { values: { email: '' }, submit: 'DONE' }) }
Account.model = { DONE: { PARENT: () => ({ wizard: 'NEXT' }) } }
```

## The flow key

A flow belongs to a record: a session, a draft being edited, a report. Name it with `key`:

| `key(state)` goes from | the flow |
|---|---|
| one key to another | starts over for the new record: `draft` and every step's slice are made again, at the first step |
| none (`null` or `undefined`) to a key | is kept, and takes the key: a key born mid-flow (step one created the session) |
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
- **Host state only:** `key` reads the host's state, not its context. Keep the route in the host's state (or the root's), as the [router recipe](/guide/router/#reading-the-route) does.

## Start over

`reset: '.start-over'`, the `wizard.RESET` action, or a step's `{ wizard: 'RESET' }` starts the flow over: the draft, every step's slice, and the first step. When the action's data (the message's `draft`) is a plain object, it is the new draft.

In URL mode it then navigates to the first step's route. `resetTo` names another place: a router command, or a function of the slice and the host's state (`resetTo: { to: 'newFilter' }`).

## Unsaved changes

```js
wizard({
  steps,
  dirty: (step, state) => step.draft.source != null,
  confirm: '.leave-dialog', leave: '.discard', stay: '.stay',
})
```

`dirty` gets the current step's state and the host's state, plus the step's name. A step's own `dirty` (and `discard`) in `steps` is used instead while it is the current step: `review: { dirty: (s) => s.name !== '' }`.

```jsx
<dialog className="leave-dialog">
  <p>Discard this filter? Nothing is saved yet.</p>
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

**A held navigation** goes in `state.wizard.leaving` and opens the `confirm` dialog with `showModal()`:
- **Discard** (`leave`) starts the flow over, or runs `discard(wizardSlice, state)` (the step's own first) and keeps what it returns. Then it makes the navigation.
- **Keep editing** (`stay`), or Escape, closes the dialog and stays.
- **A move that drops a held navigation closes the dialog.** The browser's back and forward buttons aren't stopped by a modal, so an in-flow traversal can arrive while it's open.

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
- a link to a step the user can't reach yet (an earlier step isn't valid) is replaced with the furthest reachable step.

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
- **Other props** pass through to the page, and `state` binds it.
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

## Diagnostics

- [SYG455](/reference/errors/#syg455): `<Outlet from>` names no `wizard()` in the component's `uses`.
- [SYG456](/reference/errors/#syg456): the outlet has no component in `of` (and no `fallback`) for the current step or route.
- [SYG457](/reference/errors/#syg457): an `of` key that is no step of the wizard (`sygnal-check` only).

`sygnal-check` reports SYG455 and SYG456 before the app runs too, when `uses`, `steps` and `of` are object literals.
