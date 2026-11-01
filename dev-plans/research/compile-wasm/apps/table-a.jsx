// Tier A (hand-written compiler output): the same view, each JSX element emitted as a direct
// vnode with its data pre-routed (className -> props, data={{}} -> dataset) and every static
// data object hoisted to module scope. The vnodes are still made on every render and diffed
// by snabbdom; only the pragma's run-time work is gone.
import { run } from 'sygnal'
import { P } from '../proto/compiled-runtime.js'
import { tableStatics } from './table-statics.js'

const $container = { props: { className: 'container' } }, $controls = { props: { className: 'controls' } }
const $b = (id) => ({ props: { id } })
const $run = $b('run'), $runlots = $b('runlots'), $add = $b('add'), $update = $b('update'), $clear = $b('clear'), $swap = $b('swaprows'), $last = $b('updatelast')
const $table = { props: { className: 'table' } }, $colid = { props: { className: 'col-id' } }, $lbl = { props: { className: 'lbl' } }, $remove = { props: { className: 'remove' } }
const $row = { className: 'row' }, $danger = { className: 'row danger' }

function App({ state }) {
  const sel = state.selected
  return new P('div', $container, [
    new P('div', $controls, [
      new P('button', $run, undefined, 'Create 1,000 rows'),
      new P('button', $runlots, undefined, 'Create 10,000 rows'),
      new P('button', $add, undefined, 'Append 1,000 rows'),
      new P('button', $update, undefined, 'Update every 10th row'),
      new P('button', $clear, undefined, 'Clear'),
      new P('button', $swap, undefined, 'Swap Rows'),
      new P('button', $last, undefined, 'Update last row'),
    ]),
    new P('div', $table, state.rows.map(row => new P('div', { props: row.id === sel ? $danger : $row, dataset: { id: row.id } }, [
      new P('span', $colid, undefined, '' + row.id),
      new P('a', $lbl, undefined, '' + row.label),
      new P('a', $remove, undefined, 'x'),
    ], undefined, row.id))),
  ])
}
run(tableStatics(App), {}, { mountPoint: '#main' })
