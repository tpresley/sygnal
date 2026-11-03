<!-- Draft of docs guide/wizards.md for the wizard spike. It is not in docs/ yet: the names are
     pending the maintainer's decisions (README §7), and a published page needs live demos that pass
     check-live on 3 engines. -->
# Wizards and multi-step flows

A wizard is one flow over several steps: a draft that the steps fill in, Back and Next, and a stepper. Declare it with the `wizard()` behavior, and render the current step with `<Outlet>`. Only the current step exists:
- its `BOOTSTRAP` runs when it is entered;
- its `DISPOSE` runs when it is left, and its requests, connections, timers and watches stop with it.

```jsx
import { wizard, Outlet } from 'sygnal'
import Source from './Source.jsx'
import Review from './Review.jsx'

function NewFilter({ state }) {
  const w = state.wizard
  return (
    <section>
      <ol className="wizard-steps" aria-label="Progress">
        {w.steps.map((s) => (
          <li aria-current={s.current ? 'step' : undefined}>
            {s.reachable && !s.current
              ? <button type="button" className="goto" data-step={s.name}>{s.label}</button>
              : <span>{s.label}</span>}
            {s.status === 'done' && <span className="visually-hidden"> (completed)</span>}
          </li>
        ))}
      </ol>
      <Outlet of={{ source: Source, review: Review }} from="wizard" />
      <button type="button" className="back" disabled={!w.canBack}>Back</button>
      <button type="button" className="next" disabled={!w.canNext}>{w.last ? 'Create' : 'Next'}</button>
    </section>
  )
}
NewFilter.uses = {
  wizard: wizard({
    steps: {
      source: { label: 'Source', valid: (s) => !!s.draft.source },
      review: { label: 'Review and create', visit: { creating: false } },
    },
    draft: { source: null, name: '' },
    next: '.next', back: '.back', goto: '.goto',
    finish: 'CREATE',
  }),
}
NewFilter.model = {
  CREATE: { HTTP: (state, draft) => ({ url: '/api/filters', method: 'POST', json: draft }) },
}
```

## What a step sees

A step is an ordinary component. Its `state` has two parts:
- **`state.draft`** is the flow's draft, shared by every step. Writing it (`{ ...state, draft: { ...state.draft, name } }`) is how a step fills in the flow.
- **Everything else is the step's own slice.** Its resources, a `form` behavior, open panels and busy flags all live there. Two steps can use the same names (two `session` resources, two `form`s) without colliding.

What a step's state keeps, and when:

| | Back and forth between steps | A new flow key, or Start over |
|---|---|---|
| `state.draft` | kept | made again from `draft` |
| the step's own slice | kept | made again (empty) |
| the step's `visit` fields | set again on each entry | set again |
| the step's local work (requests, watches, timers) | stopped on leave, started on entry | stopped, started |

A step with an `initialState` (and `isolatedState = true`) starts its own slice from it.

`visit` is a step's scratch: fields that must not survive leaving the step, such as a `creating` flag or an error.

## The flow key

A flow belongs to a record: a session, a draft being edited, a report. Name it with `key`. When it changes, the flow starts over for the new record:

```js
wizard({ steps, key: (state) => state.route.query.session, draft: (state) => ({ source: state.route.query.filter ?? null }) })
```

The outlet renders no step until the state belongs to the new key, so a step never shows the old record's data.

## Start over

`reset: '.start-over'` (or the `wizard.RESET` action) starts the flow over: the draft, every step's slice, and the first step. A plain object as the action's data is the new draft.

## Unsaved changes

```js
wizard({ steps, dirty: (w) => w.draft.source != null, confirm: '.leave-dialog', leave: '.discard', stay: '.stay' })
```

**While `dirty` is true,** a navigation away from the flow is held:
- a link, a router command, or the browser's back button;
- closing the tab gets the browser's own prompt.

**The `confirm` dialog** opens (`showModal`):
- **Discard** starts the flow over (or runs the `discard` option) and makes the navigation.
- **Stay**, or Escape, keeps the user in the flow.

Moving between the flow's own steps is never held: their values are kept.

## The step in the URL

```js
const router = makeRouter({ routes: { newFilter: '/filters/new/:step', … } })

wizard({ steps, key: (s) => s.route.query.session, url: { route: 'newFilter', param: 'step', key: 'session' } })
```

**The step follows the route.**
- Back, Next and the stepper navigate, and the browser's back and forward buttons move between steps.
- A link to a step the user can't reach yet (an earlier step isn't valid) is replaced with the furthest reachable step.
- The flow key goes in the query string.

## Steps that don't always apply

`when: (s) => …` leaves a step out of the flow:
- Back and Next skip it;
- the stepper marks it `skipped`;
- it isn't counted.

## Accessibility

- **Render the stepper as an ordered list** with `aria-current="step"` on the current step ([`aria-current`](https://www.w3.org/TR/wai-aria-1.2/#aria-current)).
- **Make only the steps the user can go to buttons**, and give the others a status in visually hidden text.
- **Name the step in its heading.**
- **Focus:** after a step change, the outlet moves focus to the new step's `[data-wizard-focus]` element, else its first `h1`, `h2` or `h3`, so a screen reader announces the step. The first step shown doesn't take focus. `focus={false}` turns this off.

## Route pages

The same outlet renders an app's pages, one at a time, keyed by the visit:

```jsx
<Outlet of={{ home: Home, task: TaskPage, notFound: NotFound }} route={state.route} query={['session']} />
```

A page is a new instance when the route name, its params or one of the `query` keys named change. Changing other query keys (a sort order) keeps it.
