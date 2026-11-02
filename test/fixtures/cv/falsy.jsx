// false / null / undefined in every JSX position the compiler handles (G: a porter's stray
// "false"), and components that render nothing; driven by an IN driver, mounted on a real DOM
import { run, xs, Collection } from 'sygnal'

const MODEL = {
  FLIP: (s) => ({ ...s, on: !s.on, rows: s.rows.map((r) => ({ ...r, on: !r.on })) }),
  ZERO: (s) => ({ ...s, n: 0 }),
  SOME: (s) => ({ ...s, n: 2 }),
}
const intent = ({ IN }) => !IN?.filter ? {} : Object.fromEntries(Object.keys(MODEL).map(k => [k, IN.filter(a => a.t === k).map(a => a.d)]))

function Nothing({ state }) { return state.on ? <em className="nothing">shown</em> : state.empty }
function Item({ state }) { return state.hide ? false : <li>{state.label}</li> }

export function Falsy({ state }) {
  return (
    <div className="falsy">
      <p className="a">{state.on && <b>on</b>}</p>
      <p className="b">x{false}y{null}z{undefined}</p>
      <p className="c">{state.on}{!state.on}</p>
      <p className="d">{state.on ? <i>yes</i> : null}</p>
      <p className="e" title={state.on && 'tip'} data-x={state.on || undefined}>{state.n && <u>{state.n}</u>}</p>
      <p className={state.on ? 'f on' : 'f'}>{[false, null, undefined, state.on && 'w']}</p>
      <>{state.on && <s>frag</s>}{false}</>
      <Nothing state="kid" />
      <ul><Collection of={Item} from="items" /></ul>
      {state.rows.map((r) => (
        <div key={r.id} className="row" title={r.on && 'tip'}>
          <span>{r.label}{r.on}{null}</span>{r.on && 'on'}{false}<i>{undefined}{r.n}</i>
        </div>
      ))}
    </div>
  )
}
Falsy.initialState = { on: false, n: 0, kid: { on: false, empty: false }, items: [{ id: 1, label: 'a' }, { id: 2, label: 'b', hide: true }],
  rows: [{ id: 1, label: 'r1', on: false, n: 0 }, { id: 2, label: 'r2', on: true, n: 1 }] }
Falsy.intent = intent
Falsy.model = MODEL

export function mount(App, el) {
  let push
  const in$ = xs.create({ start(l) { push = (v) => l.next(v) }, stop() {} })
  const app = run(App, { IN: () => in$ }, { mountPoint: el })
  return { send: (t, d) => push({ t, d }), dispose: app.dispose, app }
}
