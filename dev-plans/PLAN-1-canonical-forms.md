# PLAN-1 — Canonical Forms (0C)

**Status:** Approved 2026-09-30 (user decisions Q1, Q2; the remaining rows are coordinator defaults from PLAN-1 §0C that the user didn't contest).

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
| C3 | No-op from a state reducer | `return ABORT` | returning `undefined` or the identical state object | SYG502 |
| C4 | Side effect only | `{ EFFECT: (state, data, next) => { ... } }` | a STATE reducer that performs a side effect and returns `ABORT` | SYG503 (static only; heuristic) |
| C5 | Any non-STATE sink, including a single one | Object form `ACTION: { SINK: fn }` | `'ACTION \| SINK'` shorthand keys | SYG504 |
| C6 | Emit a global event | `EVENTS: event('TYPE', (state, data) => payload)` inside the object form | `emit('TYPE', fn)` as a whole entry or spread; a raw `EVENTS: s => ({ type, data })` | SYG505 |
| C7 | Child → parent | Child `PARENT: fn`; parent `CHILD.select(ChildFn)` | `CHILD.select('ChildName')` (string) | SYG506 |
| C8 | Communication between non-adjacent components | `EVENTS` (C6 to emit, `EVENTS.select('TYPE')` to receive) | — | — |
| C9 | Parent → child imperative | `createCommand()` passed as a prop; child `commands$.select('name')` | — | — |
| C10 | Top-down data | `.context` | prop drilling through more than 2 component levels | SYG507 (info, static only) |
| C11 | Multi-sink entry | Object form `{ STATE, EVENTS, PARENT, EFFECT, ... }` | — | — |

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
