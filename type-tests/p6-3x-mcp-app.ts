// PLAN-6 X-1: makeMcpAppDriver's types (options, source selects, sink values), and the same export from 'sygnal'.
import { expectTypeOf } from 'vitest'
import xs from 'xstream'
import { makeMcpAppDriver, agentTools } from 'sygnal/ai'
import type { McpAppSource, McpAppRequest, McpToolResult, McpHostContext, McpAppError } from 'sygnal/ai'
import { makeMcpAppDriver as fromCore, run } from 'sygnal'
import type { Stream } from 'xstream'

const driver = makeMcpAppDriver()
makeMcpAppDriver({ appInfo: { name: 'weather', version: '1.0.0' }, availableDisplayModes: ['inline', 'fullscreen'], autoResize: false, tools: agentTools, confirm: (info) => info.tool != 'x' })
// @ts-expect-error tools takes agentTools
makeMcpAppDriver({ tools: true })
// @ts-expect-error not a display mode
makeMcpAppDriver({ availableDisplayModes: ['maximized'] })
expectTypeOf(fromCore).toEqualTypeOf(makeMcpAppDriver)

const src = driver(xs.never())
expectTypeOf(src).toEqualTypeOf<McpAppSource>()
expectTypeOf(src.select('tool-input')).toEqualTypeOf<Stream<Record<string, any>>>()
expectTypeOf(src.select('tool-result')).toEqualTypeOf<Stream<McpToolResult>>()
expectTypeOf(src.select('host-context-changed')).toEqualTypeOf<Stream<McpHostContext>>()
src.select('tool-result').map((r) => r.structuredContent?.days)
src.select('host-context-changed').map((c) => c.theme === 'dark')
// @ts-expect-error not an event
src.select('tool-output')

const ok: McpAppRequest[] = [
  { callTool: 'get_forecast', args: { city: 'Oslo' }, ok: 'RESULT', error: 'FAILED' },
  { updateModelContext: { selectedDay: 'Mon' } },
  { updateModelContext: 'The user picked Monday' },
  { message: 'Show me Tuesday' },
  { message: [{ type: 'text', text: 'hi' }] },
  { openLink: 'https://example.com' },
  { displayMode: 'fullscreen', ok: 'MODE' },
]
// @ts-expect-error not a display mode
const bad: McpAppRequest = { displayMode: 'big' }
expectTypeOf<McpAppError['error']>().toEqualTypeOf<string>()

declare const App: any
run(App, { MCP: makeMcpAppDriver() })
void ok
void bad
