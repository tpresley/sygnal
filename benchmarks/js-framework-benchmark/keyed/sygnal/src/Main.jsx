import { ABORT } from 'sygnal'

// js-framework-benchmark, keyed: every <tr> carries key={row.id}, so snabbdom
// moves DOM rows with their data (swap, remove) instead of rewriting them.

const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy']
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange']
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard']

const pick = (list) => list[Math.round(Math.random() * 1000) % list.length]

function buildData(count, firstId) {
  const rows = new Array(count)
  for (let i = 0; i < count; i++) {
    rows[i] = { id: firstId + i, label: `${pick(adjectives)} ${pick(colours)} ${pick(nouns)}` }
  }
  return rows
}

function Main({ state }) {
  return (
    <div className="container">
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6"><h1>Sygnal (keyed)</h1></div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="run">Create 1,000 rows</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="runlots">Create 10,000 rows</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="add">Append 1,000 rows</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="update">Update every 10th row</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="clear">Clear</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="swaprows">Swap Rows</button></div>
            </div>
          </div>
        </div>
      </div>
      <table className="table table-hover table-striped test-data">
        <tbody>
          {state.rows.map((row) => (
            <tr key={row.id} className={row.id === state.selected ? 'danger' : ''} data={{ id: row.id }}>
              <td className="col-md-1">{row.id}</td>
              <td className="col-md-4"><a className="lbl">{row.label}</a></td>
              <td className="col-md-1"><a className="remove"><span className="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
              <td className="col-md-6"></td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
    </div>
  )
}

Main.initialState = { rows: [], nextId: 1, selected: 0 }

Main.intent = ({ DOM }) => ({
  RUN:      DOM.click('#run'),
  RUN_LOTS: DOM.click('#runlots'),
  ADD:      DOM.click('#add'),
  UPDATE:   DOM.click('#update'),
  CLEAR:    DOM.click('#clear'),
  SWAP:     DOM.click('#swaprows'),
  // The benchmark's markup clicks <a> elements without href (its tests select
  // `td:nth-of-type(2)>a` and `td:nth-of-type(3)>a>span`), so a <button> isn't an option.
  // sygnal-ignore SYG704
  SELECT:   DOM.click('.lbl').data('id', Number),
  // sygnal-ignore SYG704
  REMOVE:   DOM.click('.remove').data('id', Number),
})

Main.model = {
  RUN:      (state) => ({ ...state, rows: buildData(1000, state.nextId), nextId: state.nextId + 1000, selected: 0 }),
  RUN_LOTS: (state) => ({ ...state, rows: buildData(10000, state.nextId), nextId: state.nextId + 10000, selected: 0 }),
  ADD:      (state) => ({ ...state, rows: state.rows.concat(buildData(1000, state.nextId)), nextId: state.nextId + 1000 }),
  UPDATE:   (state) => {
    const rows = state.rows.slice()
    for (let i = 0; i < rows.length; i += 10) rows[i] = { ...rows[i], label: rows[i].label + ' !!!' }
    return { ...state, rows }
  },
  CLEAR:    (state) => (state.rows.length === 0 ? ABORT : { ...state, rows: [], selected: 0 }),
  SWAP:     (state) => {
    if (state.rows.length <= 998) return ABORT
    const rows = state.rows.slice()
    const second = rows[1]
    rows[1] = rows[998]
    rows[998] = second
    return { ...state, rows }
  },
  SELECT:   (state, id) => (state.selected === id ? ABORT : { ...state, selected: id }),
  REMOVE:   (state, id) => ({ ...state, rows: state.rows.filter((row) => row.id !== id) }),
}

export default Main
