// The view of the `get_forecast` tool: an MCP App. The host (Claude, ChatGPT, VS Code, ...) shows
// it in a sandboxed iframe and talks to it through the MCP driver (run(App, { MCP: makeMcpAppDriver() })).
import type { RootComponent } from 'sygnal'
import type { McpAppSource, McpAppRequest, McpAppError, McpToolResult, McpHostContext } from 'sygnal/ai'

type Day = { date: string; sky: string; high: number; low: number }
type Status = 'waiting' | 'loading' | 'ready' | 'cancelled' | 'error'

type State = {
  city: string
  days: Day[]
  selected: string | null
  status: Status
  error: string
  theme: 'light' | 'dark'
  mode: string
  canFullscreen: boolean
}

type Drivers = { MCP: { source: McpAppSource; sink: McpAppRequest } }

type Actions = {
  TYPING: Record<string, any>
  INPUT: Record<string, any>
  RESULT: McpToolResult
  FAILED: McpAppError
  CANCELLED: { reason?: string }
  HOST: McpHostContext
  REFRESH: Event
  PICK: string
  ASK: Event
  FULLSCREEN: Event
  MODE: { mode: string }
}

type App = RootComponent<State, Drivers, Actions>

const STATUS: Record<Status, string> = { waiting: 'Waiting for the tool call…', loading: 'Loading…', ready: '', cancelled: 'Cancelled', error: 'Failed' }

const App: App = function ({ state }) {
  return (
    <main className={'card ' + state.theme}>
      <header className="card-header">
        <h1>{state.city ? `Forecast for ${state.city}` : 'Forecast'}</h1>
        <span className="status" attrs={{ role: 'status' }}>{STATUS[state.status]}</span>
      </header>

      {state.error ? <p className="error">{state.error}</p> : null}

      <ul className="days">
        {state.days.map((day) => (
          <li key={day.date}>
            <button
              type="button"
              className={'day' + (day.date === state.selected ? ' selected' : '')}
              data={{ date: day.date }}
              attrs={{ 'aria-pressed': String(day.date === state.selected) }}
            >
              <span className="date">{day.date}</span>
              <span className="sky">{day.sky}</span>
              <span className="temp">{day.high}° / {day.low}°</span>
            </button>
          </li>
        ))}
      </ul>

      <footer className="actions">
        <button type="button" className="refresh" attrs={{ disabled: !state.city }}>Refresh</button>
        <button type="button" className="ask" attrs={{ disabled: !state.selected }}>Ask about this day</button>
        {state.canFullscreen && state.mode !== 'fullscreen'
          ? <button type="button" className="fullscreen">Full screen</button>
          : null}
      </footer>
    </main>
  )
}

App.initialState = {
  city: '',
  days: [],
  selected: null,
  status: 'waiting',
  error: '',
  theme: 'light',
  mode: 'inline',
  canFullscreen: false,
}

App.intent = ({ DOM, MCP }) => ({
  TYPING: MCP.select('tool-input-partial'),     // the arguments while the model writes them
  INPUT: MCP.select('tool-input'),              // the arguments the model called the tool with
  RESULT: MCP.select('tool-result'),            // the server tool's result
  CANCELLED: MCP.select('tool-cancelled'),
  HOST: MCP.select('host-context-changed'),     // theme, display mode, ...
  REFRESH: DOM.click('.refresh'),
  PICK: DOM.click('.day').data('date'),
  ASK: DOM.click('.ask'),
  FULLSCREEN: DOM.click('.fullscreen'),
})

const textOf = (result: McpToolResult) => result.content?.map((c) => c.text).filter(Boolean).join('\n') || 'The tool failed'

App.model = {
  TYPING: (state, args) => ({ ...state, city: args.city ?? state.city }),
  INPUT: (state, args) => ({ ...state, city: args.city ?? state.city, status: 'loading', error: '' }),
  RESULT: (state, result) => result.isError
    ? { ...state, status: 'error', error: textOf(result) }
    : { ...state, status: 'ready', error: '', days: result.structuredContent?.days ?? [], selected: null },
  FAILED: (state, { error }) => ({ ...state, status: 'error', error }),
  CANCELLED: (state) => ({ ...state, status: 'cancelled' }),
  HOST: (state, context) => ({
    ...state,
    theme: context.theme ?? state.theme,
    mode: context.displayMode ?? state.mode,
    canFullscreen: (context.availableDisplayModes ?? []).includes('fullscreen'),
  }),

  // call the server tool again from the view; its result comes back as RESULT
  REFRESH: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    MCP: (state) => ({ callTool: 'get_forecast', args: { city: state.city }, ok: 'RESULT', error: 'FAILED' }),
  },
  // tell the model what the user picked (it reads it on the next turn)
  PICK: {
    STATE: (state, date) => ({ ...state, selected: date }),
    MCP: (state, date) => ({ updateModelContext: { city: state.city, selectedDay: state.days.find((d) => d.date === date) } }),
  },
  // send a message to the conversation as the user
  ASK: { MCP: (state) => ({ message: `What should I pack for ${state.city} on ${state.selected}?` }) },
  FULLSCREEN: { MCP: () => ({ displayMode: 'fullscreen', ok: 'MODE' }) },
  MODE: (state, { mode }) => ({ ...state, mode }),
}

export default App
