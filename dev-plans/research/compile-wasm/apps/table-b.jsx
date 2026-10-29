// Tier B (hand-written compiler output): the rows compiled to a block. The block's template is
// the row's static markup; its holes are the root's class, its data-id and the two text nodes.
// The rest of the view is tier A.
import { run } from 'sygnal'
import { P, block } from '../proto/compiled-runtime.js'
import { tableStatics } from './table-statics.js'

const $container = { props: { className: 'container' } }, $controls = { props: { className: 'controls' } }
const $b = (id) => ({ props: { id } })
const $run = $b('run'), $runlots = $b('runlots'), $add = $b('add'), $update = $b('update'), $clear = $b('clear'), $swap = $b('swaprows'), $last = $b('updatelast')
const $table = { props: { className: 'table' } }

const Row = block('div', '<span class="col-id"> </span><a class="lbl"> </a><a class="remove">x</a>',
  [['class', []], ['dataset:id', []], ['text', [0, 0]], ['text', [1, 0]]])

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
    new P('div', $table, state.rows.map(row => Row([row.id === sel ? 'row danger' : 'row', row.id, row.id, row.label], row.id))),
  ])
}
run(tableStatics(App), {}, { mountPoint: '#main' })
