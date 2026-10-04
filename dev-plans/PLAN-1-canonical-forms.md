# PLAN-1 — Canonical Forms (0C)

**Status:** Approved 2026-09-30 (user decisions Q1, Q2; the remaining rows are coordinator defaults from PLAN-1 §0C that the user didn't contest).

**Amended for 6.0 (PLAN-4 4-D, 2026-10-03):** C3 changed by GS-4 (D110: SYG502 retired); rows C12–C16 added for the PLAN-4 declarations (D114) and `STATE.watch` (GS-6). Row C17 (CT-1 controls) records P4-D (D141, 2026-10-04): class selectors stay canonical and controls are an alternative form; see [CT-1 controls: an alternative form](#ct-1-controls-an-alternative-form-p4-d).

This document is normative for:
- **2A** strict-mode rules (each row → one SYG5xx rule, runtime and static);
- **2D** example migration;
- **Phase 3** docs, `llms.txt`, and the skill. Docs show **only** canonical forms, except on one "Alternative forms" page.

"Non-canonical" forms keep working. Strict mode flags them; nothing is removed.

---

## Rules

| # | Concept | Canonical | Non-canonical (flagged in strict mode) | Rule ID |
|---|---|---|---|---|
| C1 | View signature | `function C({ state, context, ...props })`, destructuring the first argument | positional `(props, state, context)` use of the 2nd/3rd args | SYG501 |
| C2 | State update | Plain reducer `(state, data) => ({ ...state, ... })`; `set()` / `toggle()` helpers allowed | — | — |
| C3 | No-op from a state reducer | `return ABORT` (docs, examples and agent context keep writing this) | None since 6.0. Returning the identical state object means "no change" exactly like `ABORT` (GS-4) and is **not** flagged. Returning `undefined` is not a no-op (it removes a Collection item; SYG202 at runtime in a root) and is no longer detected statically (D122). Mutating in place and returning the same object is a bug, not a form: SYG222 (dev) | SYG502 **retired in 6.0** (never reported; kept in the reference as retired) |
| C4 | Side effect only | `{ EFFECT: (state, data, next) => { ... } }` | a STATE reducer that performs a side effect and returns `ABORT` | SYG503 (static only; heuristic) |
| C5 | Any non-STATE sink, including a single one | Object form `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys | SYG504 |
| C6 | Emit a global event | `EVENTS: event('TYPE', (state, data) => payload)` inside the object form | `emit('TYPE', fn)` as a whole entry or spread; a raw `EVENTS: s => ({ type, data })` | SYG505 |
| C7 | Child → parent | Child `PARENT: fn`; parent `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (string) | SYG506 |
| C8 | Communication between non-adjacent components | `EVENTS` (C6 to emit, `EVENTS.select('TYPE')` to receive) | — | — |
| C9 | Parent → child imperative | `createCommand()` passed as a prop; child `commands$.select('name')` | — | — |
| C10 | Top-down data | `.context` | prop drilling through more than 2 component levels | SYG507 (info, static only) |
| C11 | Multi-sink entry | Object form `{ STATE, EVENTS, PARENT, EFFECT, ... }` | — | — |
| C12 | Element commands (focus, dialogs, popovers, scrolling) | The built-in `ELEMENT` sink in the object form: `ACTION: { ELEMENT: { focus: '.email' } }`, or a reducer returning a command, an array of commands, or `ABORT`. In a command object the **first key is the method** and the remaining keys are its options (D118); the target is a selector for an element the sending component renders (a control also works: alternative form, C17) | a ref or a `DOM.select(...).element()` stream plus an `EFFECT` that calls the method | — (no rule) |
| C13 | Persisting the root's state | `Root.persist = persist({ key, pick, version, migrate, ... })` (or `omit`); clear with `PERSIST: { clear: true }` in the object form | `localStorage` read by hand into `initialState` and written in an `EFFECT`. The `'ACTION \| PERSIST'` shorthand isn't handled at all (D136) | — (no rule) |
| C14 | Intervals, timeouts, animation frames | `C.timers = (state) => ({ name: cond && { every: ms, action } })` (`after`, `frame` likewise) with `makeTimerDriver()` registered in `run()` (key `TIMER` by convention) | `xs.periodic` or `setInterval` in intent, or an `EFFECT` with `next(…, ms)` loops | — (no rule) |
| C15 | Reusing state + intent + model across components | `defineBehavior({...})` and the `uses` static: `C.uses = { key: behavior(options) }`; actions are named `key.ACTION` (D109); the host passes selectors as options (controls also work: alternative form, C17) | copying the intent and model into each component | — (no rule) |
| C16 | "When this part of the state changes, do Y" | `STATE.watch(selector, { immediate })` in intent | `STATE.stream.map(selector).compose(dropRepeats(...))` | — (no rule) |

Declarations: `uses`, `persist`, `timers` and `viewTransitions` are reserved statics (like `connections`, `resources`, `route` and `head` from PLAN-3), and `uid` is a reserved view prop that C1 destructures like `state` (`function C({ state, uid })`). Helpers a component doesn't use cost 0 bytes.

## Canonical example (all rules together)

```jsx
import { ABORT, Collection, event } from 'sygnal'
import TaskCard from './TaskCard.jsx'

function Lane({ state, context }) {                                   // C1
  return (
    <div className="lane">
      <h2 className="lane-title">{state.title}</h2>
      <button className="delete-lane-btn">×</button>
      <Collection of={TaskCard} from="tasks" />
    </div>
  )
}

Lane.intent = ({ DOM, CHILD }) => ({
  RENAME:      DOM.input('.lane-title-input').map(e => e.target.value),
  DELETE_LANE: DOM.click('.delete-lane-btn'),
  DELETE_TASK: CHILD.select(TaskCard).map(e => e.taskId),            // C7
})

Lane.model = {
  RENAME: (state, title) => title.trim()                              // C2
    ? { ...state, title: title.trim() }
    : ABORT,                                                          // C3

  DELETE_LANE: {                                                      // C5, C11
    STATE:  s => ({ ...s, deleting: true }),
    EVENTS: event('DELETE_LANE', s => ({ laneId: s.id })),            // C6
  },

  DELETE_TASK: (state, taskId) =>
    ({ ...state, tasks: state.tasks.filter(t => t.id !== taskId) }),
}
```

## CT-1 controls: an alternative form (P4-D)

**Decided (D141, 2026-10-04).** The 1-E A/B eval met two of its four bars (Opus wall time 1.06×, over the +5% bar; Haiku pass rate 91.7% → 73.3%, under the "not lower" bar; learn time and wiring failures within theirs). Under PLAN-4 §7 a mixed result means an alternative form. Controls (`controls()`, CT-1) ship fully supported and documented on their own page (`guide/controls`) and on `advanced/alternative-forms`; the rest of the docs, the examples, the templates, `llms.txt` and the skill use selectors.

| # | Concept | Canonical | Non-canonical (flagged in strict mode) | Rule ID |
|---|---|---|---|---|
| C17 | Selecting an element the component's own view renders (intent, element commands, behavior options, tests) | A class or attribute selector: `<button className="add">`, `DOM.click('.add')`, `pager({ next: '.newer' })`, `{ focus: '.email' }`, `t.simulateEvent('.add', 'click')` | None. Controls (`const { Add } = controls({ Add: 'button' })`, `<Add>Add</Add>`, `DOM.click(Add)`) are an **alternative form**, not flagged | — (no strict rule; no SYG510. `sygnal-check --fix --controls` stays opt-in, D113) |

The canonical example above stays selector-based.

## New API required: `event()`

C6 needs a helper that doesn't exist yet. **Owner: 1B** (runtime in `src/extra/reducers.ts`, plus types and the EVENTS registry typing in `src/index.d.ts`).

```ts
event(type: string, payload?: any | ((state, data, next, props) => any))
  → (state, data, next, props) => { type, data }
```

- It returns a **sink function** (not a model entry), so it slots into the object form.
- Static `payload` values are allowed: `event('RESET')`, `event('SET_MODE', 'dark')`.
- With the 1B `SygnalEvents` registry, `type` is checked against registered names, and the payload against that event's data type.
- `emit()` stays as a supported alias (non-canonical, SYG505 in strict mode). It is **not** deprecated in this plan.
- Naming caveat (see tracker G-007): `event` is a common callback parameter name (`DOM.click(...).map(event => ...)`). The local name shadows the import, which is harmless but can confuse readers. Revisit the name before release if 2D migration shows it causing confusion.
