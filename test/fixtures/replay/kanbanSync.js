// sygnal/replay tests: examples/kanban's RootComponent, unchanged, plus an autosave: a
// makeTimerDriver timer (`every` 200 ms) whose tick POSTs the board through makeFetchDriver when it
// changed since the last save, and a SAVED reply whose reducer reads now() (the canonical form)
// and Math.random() (a global, on purpose: the recorder's fallback). The example's ADD_TASK reads
// uuid(). The example's own statics are reused as they are.
import { ABORT } from 'sygnal'
import RootComponent from '../../../examples/kanban/src/RootComponent.jsx'

export const API = 'http://api.test'

/** a small structural hash of the lanes (what was saved) */
const sig = lanes => lanes.map(l => l.id + ':' + l.title + ':' + l.tasks.map(t => t.id).join(',')).join('|')

export default function KanbanSync(props) {
  return RootComponent(props)
}
Object.assign(KanbanSync, RootComponent)
KanbanSync.initialState = { ...RootComponent.initialState, saved: sig(RootComponent.initialState.lanes), saves: 0, savedAt: null, saveId: null }
KanbanSync.timers = () => ({ autosave: { every: 200, action: 'AUTOSAVE' } })
KanbanSync.model = {
  ...RootComponent.model,
  AUTOSAVE: {
    STATE: (state) => sig(state.lanes) === state.saved ? ABORT : { ...state, saved: sig(state.lanes) },
    HTTP: (state, _d, _n, { previousState }) => state.saved === previousState.saved ? ABORT
      : { url: API + '/board', method: 'POST', json: { lanes: state.lanes.map(l => ({ id: l.id, title: l.title, tasks: l.tasks.map(t => t.id) })) }, ok: 'SAVED' },
  },
  SAVED: (state, body, next, { now }) => ({ ...state, saves: body.saves, savedAt: now(), saveId: Math.random().toString(36).slice(2, 8) }),
}
