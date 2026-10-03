// D77: 'sygnal/devtools' (the dev-only DevTools bridge) and the core getDevTools()
import 'sygnal/devtools'
import { getDevTools as devEntry, installDevTools } from 'sygnal/devtools'
import { getDevTools } from 'sygnal'
import type { SygnalDevTools } from 'sygnal'

// The core accessor: undefined unless the entry was loaded (always in production builds)
const core: SygnalDevTools | undefined = getDevTools()
// @ts-expect-error may be undefined
const notNull: SygnalDevTools = getDevTools()

const dt = devEntry()
const connected: boolean = dt.connected
const codes: string[] = dt.getDiagnostics().map(d => d.code)
const installed: ReturnType<typeof devEntry> | undefined = installDevTools()

export { core, notNull, connected, codes, installed }

// PLAN-4 3-E (GS-10): the action log and "Copy as test"
import {
  recordActions, isRecording, clearActions, getActions, onAction, getSession, copyAsTest, copyAsTestResult, connectReduxDevtools,
} from 'sygnal/devtools'
import type { DevtoolsAction, SessionRecording, CopyAsTestResult, DevtoolsActionCause } from 'sygnal/devtools'

const stop: () => void = recordActions()
const on: boolean = isRecording()
clearActions()
const list: DevtoolsAction[] = getActions({ component: 'App', type: /^SAVE/, cause: ['intent', 'reply'] })
const cause: DevtoolsActionCause = list[0].cause
const before: any = list[0].before
// @ts-expect-error not a cause
getActions({ cause: 'click' })
const off: () => void = onAction((a, kind) => { if (kind === 'add') a?.type.toUpperCase() })
function App() { return null }
const session: SessionRecording = getSession(App)
const s2: SessionRecording = getSession('12')
// @ts-expect-error a recording is not a getSession target
getSession(session)
const code: string = copyAsTest(session, { componentImport: "import App from './App.js'", drivers: { DND: 'fakeDnd()' }, environment: 'jsdom' })
const result: CopyAsTestResult = copyAsTestResult(undefined, { testName: 'replays' })
const done: boolean = result.complete
// @ts-expect-error drivers are source code strings
copyAsTest(undefined, { drivers: { DND: () => null } })
dt.configureCopyAsTest({ componentImport: "import App from './App.js'" })
const disconnect: () => void = connectReduxDevtools(undefined, { name: 'App', filter: a => a.cause !== 'next' })

export { stop, on, cause, before, off, s2, code, done, disconnect }
