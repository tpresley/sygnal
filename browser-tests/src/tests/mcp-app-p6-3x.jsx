// PLAN-6 3-X (X-1): makeMcpAppDriver in a real iframe (mcp-app-frame.html, src/mcp/frame.jsx), with
// the MCP Apps SDK's own host (AppBridge + PostMessageTransport from @modelcontextprotocol/ext-apps,
// a devDependency of this package only) in this page: the ui/initialize handshake, the tool input
// and result, tools/call through the host, update-model-context, host context changes, size
// reports from a real ResizeObserver, and teardown. One iframe for the whole suite.
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import { assert, runTest, waitFor } from '../harness.js'

const CAT = 'MCP Apps driver (PLAN-6 X-1)'

export async function mcpAppTestsP6_3X() {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:320px;height:120px;border:0'
  document.body.appendChild(iframe)
  const log = { ctx: [], sizes: [], calls: [] }
  const bridge = new AppBridge(null, { name: 'browser-test-host', version: '1.0.0' },
    { serverTools: {}, updateModelContext: { structuredContent: {} } },
    { hostContext: { theme: 'light', displayMode: 'inline' } })
  bridge.onupdatemodelcontext = async (p) => { log.ctx.push(p.structuredContent); return {} }
  bridge.onsizechange = (p) => { log.sizes.push(p) }
  bridge.oncalltool = async ({ name, arguments: args }) => {
    log.calls.push([name, args])
    return { content: [{ type: 'text', text: 'ok' }], structuredContent: { days: ['Wed', 'Thu'] } }
  }
  let initialized = false
  bridge.oninitialized = () => { initialized = true }
  const doc = () => iframe.contentDocument
  const text = (sel) => doc()?.querySelector(sel)?.textContent
  const click = (sel) => doc().querySelector(sel).click()

  try {
    await runTest(CAT, 'the ui/initialize handshake with the SDK host, through window.parent', async () => {
      await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow))
      iframe.src = '/mcp-app-frame.html'
      await waitFor(() => initialized, 8000)
      assert(bridge.getAppVersion()?.name === 'frame', 'appInfo: ' + JSON.stringify(bridge.getAppVersion()))
    }, 10000)

    await runTest(CAT, 'tool input and tool result reach the view', async () => {
      await bridge.sendToolInput({ arguments: { city: 'Lisbon' } })
      await bridge.sendToolResult({ content: [], structuredContent: { days: ['Mon', 'Tue'] } })
      await waitFor(() => text('.city') === 'Lisbon' && text('.days') === 'Mon,Tue')
    })

    await runTest(CAT, 'callTool goes to the host and its result comes back as the ok action', async () => {
      click('.refresh')
      await waitFor(() => text('.days') === 'Wed,Thu')
      assert(JSON.stringify(log.calls) === '[["get_forecast",{"city":"Lisbon"}]]', JSON.stringify(log.calls))
    })

    await runTest(CAT, 'updateModelContext reaches the host', async () => {
      click('.pick')
      await waitFor(() => log.ctx.length === 1)
      assert(log.ctx[0].picked === 'Wed', JSON.stringify(log.ctx))
    })

    await runTest(CAT, 'a host context change reaches the view', async () => {
      bridge.setHostContext({ theme: 'dark', displayMode: 'inline' })
      await waitFor(() => doc().querySelector('.view.dark'))
    })

    await runTest(CAT, 'size-changed reports follow the document', async () => {
      await waitFor(() => log.sizes.length >= 1)
      const before = log.sizes.at(-1).height
      click('.tall')
      await waitFor(() => log.sizes.at(-1).height >= before + 400)
    })

    await runTest(CAT, 'teardown: the view runs its action, then answers', async () => {
      const r = await bridge.teardownResource({})
      assert(JSON.stringify(r) === '{}', JSON.stringify(r))
      assert(log.ctx.at(-1)?.closing === true, 'the teardown action ran before the answer: ' + JSON.stringify(log.ctx))
    })
  } finally {
    try { await bridge.close() } catch (_) {}
    iframe.remove()
  }
}
