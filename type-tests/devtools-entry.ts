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
