# Components and composition

Child props, `CHILD.select`, Collection (keys, removal, filter/sort), Switchable, extracting a component, commands (parent → child).

## Child props and CHILD.select
- **Child props**: `<Rating name="food" value={state.food} />` → `function Rating({ state, name, value })`; reducers read `props.name` (4th arg); intent gets `props$`. Reserved: `state` (lens: `"key"` or `{ get, set }`), `children`, `slots`, `context`, `uid` (SYG106). Without `state=` a child shares its parent's whole state. A child rendered by tag (`<Stopwatch state="stopwatch" />`) has no `initialState`: its start values go in the parent's (`stopwatch: { ms: 0 }`); its own is SYG405 and the parent renders its error fallback (unseen when a test renders the child as root). `uid('email')` (view prop) is a stable per-instance id for `id`/`for`/`aria-*` pairs.
- **CHILD.select(Comp)** emits exactly what the child's `PARENT` function returned, for every instance (Collection items too). Put an id in the payload.

## Child → parent (PARENT + CHILD.select), Collection, item removal
```jsx
import { Collection } from 'sygnal'
function TaskItem({ state }) {
  return (
    <li className="task" data={{ id: state.id }}>
      {state.title} <button className="pick">pick</button> <button className="remove">x</button>
    </li>
  )
}
TaskItem.intent = ({ DOM }) => ({ PICK: DOM.click('.pick'), REMOVE: DOM.click('.remove') })
TaskItem.model = {
  PICK:   { PARENT: (state) => ({ taskId: state.id }) },   // the parent receives exactly this value
  REMOVE: () => undefined,                                   // a Collection item removes itself
}
function TaskList({ state }) {
  return (
    <div>
      <p className="picked">{state.picked}</p>
      <Collection of={TaskItem} from="tasks" className="tasks" />
    </div>
  )
}
TaskList.initialState = { picked: null, tasks: [{ id: 1, title: 'Write' }, { id: 2, title: 'Test' }] }
TaskList.intent = ({ CHILD }) => ({ PICKED: CHILD.select(TaskItem) })  // the function, not a string
TaskList.model = { PICKED: (state, { taskId }) => ({ ...state, picked: taskId }) }
```
- Removal in the object form keeps the STATE entry: `REMOVE: { STATE: () => undefined, EVENTS: event('REMOVED', (state) => state.id) }`. Without `STATE: () => undefined` the item stays.
- `from` names an array field; items are keyed by `.id` (else index). `filter={t => !t.done}`; `sort="title"`, `sort={{ title: 'desc' }}`, an array of those, or a compare function: they only change what renders, and an item's edit is written back to its element by key. Items render inside one `<div>` (`className` sets its class).
- Switchable: `<Switchable of={{ home: Home, settings: Settings }} current={state.tab} />` (optional `state="slice"`). Hidden pages stay alive; `instance={key}` re-creates the current page with fresh state when the key changes.

## Extract a component without changing the markup
**First**, on the unchanged code, pin the HTML: `expect(t.html()).toMatchSnapshot()` initially and after one interaction (run once with `npx vitest run -u`). Move the elements into the child verbatim (a component adds no wrapper or attributes); props in, `PARENT` out with an id, no `initialState`. The parent renders `<Child name="food" value={state.food} />`, drops the old selectors (SYG104) and listens with `CHILD.select(Child)`. The snapshot must still match.
```jsx
function StarRating({ name, value }) {
  return <div className={`rating ${name}`}>{[1, 2, 3].map(n => <button className={n <= value ? 'star filled' : 'star'} data-value={String(n)}>★</button>)}</div>
}
StarRating.intent = ({ DOM }) => ({ PICK: DOM.click('.star').data('value', Number) })
StarRating.model = { PICK: { PARENT: (state, value, next, props) => ({ name: props.name, value }) } }
// parent: intent RATE: CHILD.select(StarRating); model RATE: (state, { name, value }) => ({ ...state, [name]: value })
```

## Commands (parent → child) + EFFECT
`const player = createCommand()` (from `'sygnal'`); the parent renders `<Player commands={player} state="player" />` and calls it from an EFFECT (side effect only, returns nothing): `PLAY: { EFFECT: () => player.send('play', data?) }`; the child listens with `PLAY: commands$.select('play')` (emits `send()`'s data).
