import { run, Collection, sortable, undo } from 'sygnal'

// items read the drag state through context: nothing is wired per item
function Task({ state, context }) {
  const { dragging, over, after, helpId } = context.sort
  const id = String(state.id)
  const cls = ['task', dragging === id && 'dragging', over === id && dragging !== id && (after ? 'drop-after' : 'drop-before')]
  return (
    <li className={cls.filter(Boolean).join(' ')} data-id={state.id}>
      <button type="button" className="grip" aria-label={`Move ${state.title}`} aria-describedby={helpId}
        aria-pressed={String(dragging === id)}>⠿</button>
      <span>{state.title}</span>
    </li>
  )
}

export function Kanban({ state }) {
  return (
    <section>
      <p id={state.sort.helpId} hidden>
        Space or Enter picks a task up, Up and Down move it, Left and Right change lists, Space or Enter drops, Escape cancels.
      </p>
      <div className="row">
        <button className="undo" disabled={!state.history.canUndo}>Undo</button>
        <button className="redo" disabled={!state.history.canRedo}>Redo</button>
        <span className="muted">{state.drops} drops · {state.history.past.length} undo steps</span>
      </div>
      <div className="vt-board">
        <ul className="sortable-list lane" data-list="todo" aria-label="To do"><Collection of={Task} from="todo" /></ul>
        <ul className="sortable-list lane" data-list="done" aria-label="Done"><Collection of={Task} from="done" /></ul>
      </div>
      <p className="status" role="status" aria-live="assertive">{state.sort.message || 'Drag a handle, or focus one and press Space.'}</p>
    </section>
  )
}

Kanban.initialState = {
  todo: [{ id: 'a', title: 'Write the spec' }, { id: 'b', title: 'Build it' }, { id: 'c', title: 'Review' }],
  done: [{ id: 'd', title: 'Kick-off' }],
  drops: 0,
}

Kanban.uses = {
  sort: sortable({
    from: ['todo', 'done'],
    item: '.task',
    handle: '.grip',
    // your own wording for an announcement; the others keep their English defaults
    messages: { drop: (label, position, count, list) => `${label} landed at ${position} of ${count}${list ? ` in "${list}"` : ''}.` },
  }),
  // both lists recorded together: one drag (also between lists) is one undo step
  history: undo({ key: ['todo', 'done'], undo: '.undo', redo: '.redo' }),
}

Kanban.context = { sort: (state) => state.sort }

Kanban.model = {
  'sort.DROPPED': (state) => ({ ...state, drops: state.drops + 1 }),
}

export const start = (mountPoint, uid) => run(Kanban, {}, { mountPoint, uid })
