/** One row of the layers panel: a VirtualCollection item; every interaction goes to the App (PARENT). */
import {xs} from 'sygnal'
import type {Row} from './model'

const ICON: Record<string, string> = {rect: '▭', ellipse: '◯', text: 'T', frame: '#'}

export function LayerRow({state, context}: any) {
  const r: Row = state
  const drop = context.drop?.id === r.id ? ' drop-' + context.drop.where : ''
  const cls = 'layer' + (context.selected.includes(r.id) ? ' selected' : '') + (r.hidden ? ' is-hidden' : '') + drop
  return (
    <div className={cls} draggable="true" data={{id: r.id}} style={{paddingLeft: 8 + r.depth * 14 + 'px'}}>
      <span className="icon" aria-hidden="true">{ICON[r.type]}</span>
      {context.renaming === r.id
        ? <input className="rename" aria-label="Layer name" value={context.draft ?? r.name} />
        : <span className="name" role="button" tabIndex={0}>{r.name}</span>}
      <button className={'lock' + (r.locked ? ' on' : '')} aria-label={r.locked ? 'Unlock' : 'Lock'} aria-pressed={String(r.locked)}>{r.locked ? '🔒' : '🔓'}</button>
      <button className={'eye' + (r.hidden ? ' on' : '')} aria-label={r.hidden ? 'Show' : 'Hide'} aria-pressed={String(r.hidden)}>{r.hidden ? '◌' : '◉'}</button>
    </div>
  )
}

// where a drag over a row would drop: the top quarter is above it, the bottom quarter below, a frame's middle inside
const where = (e: any) => {
  const row = e.target.closest?.('.layer'), b = row?.getBoundingClientRect?.()
  if (!b || !b.height) return 'after'
  const f = (e.clientY - b.top) / b.height
  return f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'inside'
}

LayerRow.intent = ({DOM}: any) => ({
  SELECT: xs.merge(DOM.click('.name'), DOM.select('.name').events('keydown').filter((e: any) => e.key == 'Enter' || e.key == ' ')),
  RENAME_INPUT: DOM.input('.rename').value(),
  RENAME_START: DOM.dblclick('.name'),
  RENAME: DOM.select('.rename').events('keydown').filter((e: any) => e.key == 'Enter').map((e: any) => e.target.value),
  RENAME_BLUR: DOM.blur('.rename').map((e: any) => e.target.value),
  RENAME_CANCEL: DOM.select('.rename').events('keydown').filter((e: any) => e.key == 'Escape'),
  HIDE: DOM.click('.eye'),
  LOCK: DOM.click('.lock'),
  // Firefox starts a drag only with data set: an imperative call in the intent
  DRAG_START: DOM.select('.layer').events('dragstart').map((e: any) => e.dataTransfer?.setData('text/plain', '')),
  DRAG_OVER: DOM.select('.layer').events('dragover', {preventDefault: true}).map(where),
  DROP: DOM.select('.layer').events('drop', {preventDefault: true}),
  DRAG_END: DOM.select('.layer').events('dragend'),
})

LayerRow.model = {
  SELECT: {PARENT: (s: Row, e: any) => ({kind: 'select', id: s.id, shift: e.shiftKey})},
  RENAME_START: {PARENT: (s: Row) => ({kind: 'rename-start', id: s.id}), ELEMENT: () => [{focus: '.rename'}, {select: '.rename'}]},
  RENAME_INPUT: {PARENT: (s: Row, name: string) => ({kind: 'rename-draft', id: s.id, name})},
  RENAME: {PARENT: (s: Row, name: string) => ({kind: 'rename', id: s.id, name})},
  RENAME_BLUR: {PARENT: (s: Row, name: string) => ({kind: 'rename', id: s.id, name})},
  RENAME_CANCEL: {PARENT: (s: Row) => ({kind: 'rename-cancel', id: s.id})},
  HIDE: {PARENT: (s: Row) => ({kind: 'hide', id: s.id})},
  LOCK: {PARENT: (s: Row) => ({kind: 'lock', id: s.id})},
  DRAG_START: {PARENT: (s: Row) => ({kind: 'dragstart', id: s.id})},
  DRAG_OVER: {PARENT: (s: Row, w: string) => ({kind: 'dragover', id: s.id, where: w})},
  DROP: {PARENT: (s: Row) => ({kind: 'drop', id: s.id})},
  DRAG_END: {PARENT: (s: Row) => ({kind: 'dragend', id: s.id})},
}
