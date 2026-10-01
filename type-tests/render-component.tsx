import { renderComponent, run } from 'sygnal'
import type { RenderResult, RunOptions } from 'sygnal'

function Counter({ state }: any) { return <div>{state.n}</div> }

async function check() {
  const t: RenderResult = renderComponent(Counter, { initialState: { n: 0 }, diagnostics: 'collect', strict: true })
  await t.ready()
  t.simulateEvent('.inc', 'click', { key: 'Enter', target: { value: 'x' } })
  t.simulateAction('INC')
  const s = await t.waitForState(s => s.n === 1)
  const html: string = t.html()
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
  t.dispose()
  return [s, html, events, sink, codes]
}
// G-036: run() takes diagnostics.strict
const runOptions: RunOptions = { diagnostics: { mode: 'warn', strict: true, ignore: ['SYG105'] } }
export const startStrict = () => run(Counter, {}, { diagnostics: { strict: true } })
// @ts-expect-error strict is a boolean
export const badStrict: RunOptions = { diagnostics: { strict: 'yes' } }

export { runOptions }
export default check
