import { renderComponent } from 'sygnal'
import type { RenderResult } from 'sygnal'

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
  t.dispose()
  return [s, html, events, sink, codes]
}
export default check
