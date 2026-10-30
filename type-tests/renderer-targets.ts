// sygnal/host, sygnal/terminal, sygnal/agent-ui (research: dev-plans/research/alt-renderers)
import { run } from 'sygnal'
import { HostDocument, HostEvent, makeHostDriver, registerFieldTags, activate, pressKey, computeStyle, nodeId } from 'sygnal/host'
import type { HostElement, HostStyleRule } from 'sygnal/host'
import { createTerminal, runTerminal, parseKeys, paint } from 'sygnal/terminal'
import type { Frame, TerminalStyleRule } from 'sygnal/terminal'
import { createAgentUI, runAgentUI, serveMcp } from 'sygnal/agent-ui'
import type { AgentUIResult, AgentNode } from 'sygnal/agent-ui'

declare const App: any

const doc = new HostDocument()
const src = makeHostDriver(doc, { onPatch: (root: HostElement) => root.childNodes.length })(null as any)
src.select('.go').events('click').value().map((v: string) => v.length)
registerFieldTags('textinput')
const el: HostElement = doc.createElement('button')
const ok: boolean = activate(el, { onNavigate: (href: string) => href }) && pressKey(el, 'Enter', { shiftKey: true })
el.dispatchEvent(new HostEvent('custom', { detail: 1 }))
const rules: HostStyleRule[] = [['.x', { display: 'none' }]]
const display: string | undefined = computeStyle(el, rules).display
const id: number = nodeId(el)

const term = createTerminal({ width: 40, styles: [['h1', { bold: true, color: 'green' }]] as TerminalStyleRule[] })
run(App, { DOM: term.driver })
term.press('Tab', { shiftKey: true })
const frame: Frame = term.render()
const lines: string[] = paint(doc, { width: 20 }).plain
const keys = parseKeys('\t').map((k) => k.key)
const { stop } = runTerminal(App, { footer: false, onExit: () => {} })

const { app, ui } = runAgentUI(App, { styles: rules })
const tree: AgentNode[] = ui.tree()
ui.call('ui_click', { ref: 'e1' }).then((r: AgentUIResult) => (r.ok ? r.snapshot : r.error))
const server = serveMcp(ui, { name: 'x', tools: { list: () => [], call: async () => ({}) } })
server.done.then(() => server.stop())
createAgentUI().chatTools().ui_click.inputSchema

// @ts-expect-error a key name is a string
term.press(13)
// @ts-expect-error ui.call answers a promise of a result, not a string
const bad: string = ui.call('ui_snapshot')

export { ok, display, id, lines, keys, stop, app, tree, frame, bad }
