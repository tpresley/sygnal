// PLAN-6 2-W: experimentalExposeWebMcp's types (src/ai.d.ts), from sygnal/ai and sygnal
import { run } from 'sygnal'
import * as main from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import type { ExposeWebMcpOptions, WebMcpHandle, AgentConfirmInfo } from 'sygnal/ai'

declare const App: any
const app = run(App)
const stop: WebMcpHandle = experimentalExposeWebMcp(app)
const available: boolean = stop.available
stop()
experimentalExposeWebMcp(app, {
  exposedTo: ['https://agent.example'],
  prefix: 'shop_',
  modelContext: {},
  confirm: async (info: AgentConfirmInfo) => info.tool.length > 0,
})
experimentalExposeWebMcp(app, { confirm: false })
const o: ExposeWebMcpOptions = { confirm: true }
main.experimentalExposeWebMcp(app, o)
// @ts-expect-error prefix is a string
experimentalExposeWebMcp(app, { prefix: 1 })
// @ts-expect-error exposedTo is a list of origins
experimentalExposeWebMcp(app, { exposedTo: 'https://agent.example' })
// @ts-expect-error available is read-only
stop.available = true
void available
