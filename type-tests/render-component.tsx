import { renderComponent, run } from 'sygnal'
import type { RenderResult, RunOptions } from 'sygnal'

function Counter({ state }: any) { return <div>{state.n}</div> }

async function check() {
  const t: RenderResult = renderComponent(Counter, { initialState: { n: 0 }, diagnostics: 'collect', strict: true })
  // D214: ancestor context for a child tested alone
  renderComponent(Counter, { context: { lang: 'fr', user: { id: 1 } } })
  // @ts-expect-error context is an object of values
  renderComponent(Counter, { context: 'fr' })
  await t.ready()
  t.simulateEvent('.inc', 'click', { key: 'Enter', target: { value: 'x' } })
  t.simulateAction('INC')
  const s = await t.waitForState(s => s.n === 1)
  const html: string = t.html()
  // G-125: t.state is the latest state, read-only
  const latest = t.state.n
  // @ts-expect-error t.state is read-only
  t.state = { n: 2 }
  const events = t.emitted.map(e => e.type)
  const sink: any[] = t.sinkValues('HTTP')
  t.expectNoDiagnostics()
  const codes = t.diagnostics.map(d => d.code)
  // @ts-expect-error unknown option
  renderComponent(Counter, { nope: true })
  // G-053: timing options
  renderComponent(Counter, { timeoutMs: 5000, settleMs: 50, eventWaitMs: 100 }).dispose()
  // @ts-expect-error timing options are numbers
  renderComponent(Counter, { settleMs: '50' })
  // E4: real DOM mode
  const r = renderComponent(Counter, { dom: 'real' })
  const box = r.query('input[type="checkbox"]') as HTMLInputElement | null
  const checked: boolean | undefined = box?.checked
  const rows: Element[] = r.queryAll('.row')
  const root: Element | null = r.container
  // @ts-expect-error dom is 'mock' | 'real'
  renderComponent(Counter, { dom: 'jsdom' })
  r.dispose()
  t.dispose()
  void [checked, rows, root, latest]
  return [s, html, events, sink, codes]
}
// G-036: run() takes diagnostics.strict
const runOptions: RunOptions = { diagnostics: { mode: 'warn', strict: true, ignore: ['SYG105'] } }
export const startStrict = () => run(Counter, {}, { diagnostics: { strict: true } })
// @ts-expect-error strict is a boolean
export const badStrict: RunOptions = { diagnostics: { strict: 'yes' } }

export { runOptions }
export default check
