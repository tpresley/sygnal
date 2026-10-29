// The benchmark table's intent and model (benchmarks/audit/apps/sygnal/table.jsx), shared by
// the base and compiled variants so only the view differs
import { buildData } from '../../../../benchmarks/audit/lib/data.js'

export function tableStatics(App) {
  App.initialState = { rows: [], selected: 0 }
  App.intent = ({ DOM }) => ({
    RUN: DOM.click('#run'),
    RUNLOTS: DOM.click('#runlots'),
    ADD: DOM.click('#add'),
    UPDATE: DOM.click('#update'),
    CLEAR: DOM.click('#clear'),
    SWAP: DOM.click('#swaprows'),
    UPDATELAST: DOM.click('#updatelast'),
    SELECT: DOM.click('.lbl').data('id', Number),
    REMOVE: DOM.click('.remove').data('id', Number),
  })
  App.model = {
    RUN: (state) => ({ ...state, rows: buildData(1000), selected: 0 }),
    RUNLOTS: (state) => ({ ...state, rows: buildData(10000), selected: 0 }),
    ADD: (state) => ({ ...state, rows: state.rows.concat(buildData(1000)) }),
    UPDATE: (state) => ({ ...state, rows: state.rows.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + ' !!!' } : r)) }),
    CLEAR: (state) => ({ ...state, rows: [], selected: 0 }),
    SWAP: (state) => {
      if (state.rows.length < 999) return state
      const rows = state.rows.slice(); const t = rows[1]; rows[1] = rows[998]; rows[998] = t
      return { ...state, rows }
    },
    UPDATELAST: (state) => ({ ...state, rows: state.rows.map((r, i) => (i === state.rows.length - 1 ? { ...r, label: r.label + ' !!!' } : r)) }),
    SELECT: (state, id) => ({ ...state, selected: id }),
    REMOVE: (state, id) => ({ ...state, rows: state.rows.filter(r => r.id !== id) }),
  }
  return App
}

export function collStatics(App, Row) {
  Row.intent = ({ DOM }) => ({ SELECT: DOM.click('.lbl'), REMOVE: DOM.click('.remove') })
  Row.model = {
    SELECT: { PARENT: (state) => state.id },
    REMOVE: () => undefined,
  }
  App.initialState = { rows: [], selected: 0 }
  App.context = { selected: (state) => state.selected }
  App.intent = ({ DOM, CHILD }) => ({
    RUN: DOM.click('#run'),
    RUNLOTS: DOM.click('#runlots'),
    ADD: DOM.click('#add'),
    UPDATE: DOM.click('#update'),
    CLEAR: DOM.click('#clear'),
    SWAP: DOM.click('#swaprows'),
    SELECTED: CHILD.select(Row),
  })
  App.model = {
    RUN: (state) => ({ ...state, rows: buildData(1000), selected: 0 }),
    RUNLOTS: (state) => ({ ...state, rows: buildData(10000), selected: 0 }),
    ADD: (state) => ({ ...state, rows: state.rows.concat(buildData(1000)) }),
    UPDATE: (state) => ({ ...state, rows: state.rows.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + ' !!!' } : r)) }),
    CLEAR: (state) => ({ ...state, rows: [], selected: 0 }),
    SWAP: (state) => {
      if (state.rows.length < 999) return state
      const rows = state.rows.slice(); const t = rows[1]; rows[1] = rows[998]; rows[998] = t
      return { ...state, rows }
    },
    SELECTED: (state, id) => ({ ...state, selected: id }),
  }
  return App
}
