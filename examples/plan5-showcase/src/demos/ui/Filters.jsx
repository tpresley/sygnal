import { run } from 'sygnal'
import { popover } from 'sygnal/ui'

export function Filters({ state, uid }) {
  const anchor = '--' + uid('filters-anchor')
  return (
    <div>
      <div className="row">
        {/* popovertarget is written as an attribute: the browser opens and light-dismisses it */}
        <button className="filters-button" popovertarget={uid('filters')} style={{ anchorName: anchor }}>Filters</button>
        <button className="open-from-model">Open from the model</button>
      </div>
      <div className="filters" id={uid('filters')} popover="auto" aria-label="Filters"
        style={{ positionAnchor: anchor, positionArea: 'bottom span-right', margin: '4px 0 0', inset: 'auto' }}>
        <label><input type="checkbox" className="only-open" checked={state.onlyOpen} /> Only open tasks</label>
        <div className="row"><button className="filters-done">Done</button></div>
      </div>
      <output>{state.filters.open ? 'Choosing filters…' : 'Closed'} · only open: {String(state.onlyOpen)}</output>
    </div>
  )
}

Filters.initialState = { onlyOpen: false }
Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done' }) }
Filters.intent = ({ DOM }) => ({
  ONLY_OPEN: DOM.change('.only-open').checked(),
  'filters.OPEN': DOM.click('.open-from-model'),
})
Filters.model = { ONLY_OPEN: (state, onlyOpen) => ({ ...state, onlyOpen }) }

export const start = (mountPoint, uid) => run(Filters, {}, { mountPoint, uid })
