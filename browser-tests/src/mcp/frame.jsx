// PLAN-6 3-X: an MCP App view in a real iframe, on the default options (window.parent is the host,
// postMessage both ways, size reports from a real ResizeObserver). The host test reads its DOM.
import { run } from 'sygnal'
import { makeMcpAppDriver } from 'sygnal/ai'

function View({ state }) {
  return (
    <div className={'view ' + state.theme}>
      <p className="city">{state.city}</p>
      <p className="days">{state.days.join(',')}</p>
      <p className="error">{state.error}</p>
      <button type="button" className="refresh">Refresh</button>
      <button type="button" className="pick">Pick</button>
      <button type="button" className="tall">Taller</button>
      {state.tall ? <div style={{ height: '400px' }}>tall</div> : null}
    </div>
  )
}
View.initialState = { city: '', days: [], error: '', theme: 'light', tall: false }
View.intent = ({ DOM, MCP }) => ({
  INPUT: MCP.select('tool-input'),
  RESULT: MCP.select('tool-result'),
  HOST: MCP.select('host-context-changed'),
  BYE: MCP.select('teardown'),
  REFRESH: DOM.click('.refresh'),
  PICK: DOM.click('.pick'),
  TALL: DOM.click('.tall'),
})
View.model = {
  INPUT: (state, { city }) => ({ ...state, city }),
  RESULT: (state, r) => ({ ...state, days: r.structuredContent.days }),
  FAILED: (state, { error }) => ({ ...state, error }),
  HOST: (state, ctx) => ({ ...state, theme: ctx.theme }),
  REFRESH: { MCP: (state) => ({ callTool: 'get_forecast', args: { city: state.city }, ok: 'RESULT', error: 'FAILED' }) },
  PICK: { MCP: (state) => ({ updateModelContext: { picked: state.days[0] } }) },
  BYE: { MCP: () => ({ updateModelContext: { closing: true } }) },
  TALL: (state) => ({ ...state, tall: true }),
}

run(View, { MCP: makeMcpAppDriver({ appInfo: { name: 'frame', version: '1.0.0' } }) })
