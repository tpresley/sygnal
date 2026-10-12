import { pager } from 'sygnal'
export function TaskList({ state }) {
  const { offset, pageSize, page, hasPrev, hasNext } = state.pager
  return (
    <div>
      <ul>{state.tasks.slice(offset, offset + pageSize).map(task => <li>{task.title}</li>)}</ul>
      <button className="older" disabled={!hasPrev}>Older</button>
      <span className="page">{page + 1}</span>
      <button className="newer" disabled={!hasNext}>Newer</button>
    </div>
  )
}
TaskList.initialState = { tasks: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: 'Task ' + (i + 1) })) }
TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }
