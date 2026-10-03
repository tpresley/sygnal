// @vitest-environment jsdom
// D77 / G-100: the DevTools bridge left the core. run() no longer installs it; the
// dev-only 'sygnal/devtools' entry does on import (sygnal/vite injects it in dev).
// Runs against the built package (npm run build): the entry imports 'sygnal'.
import { describe, it, expect } from 'vitest'
import * as core from '../dist/index.esm.js'

const EXT = '__SYGNAL_DEVTOOLS_EXTENSION__'

function App({ state }) {
  return core.h('div', `count ${state.count}`)
}
App.initialState = { count: 1 }

function mount() {
  document.body.innerHTML = '<div id="root"></div>'
  return core.run(App, {}, { mountPoint: '#root' })
}

describe("sygnal/devtools (D77)", () => {
  it('run() alone does not install the bridge, and the core getDevTools() is undefined', () => {
    const app = mount()
    try {
      expect(window.__SYGNAL_DEVTOOLS__).toBeUndefined()
      expect(core.getDevTools()).toBeUndefined()
      // run() still exposes the app for time-travel (cheap, used by the bridge)
      expect(window.__SYGNAL_DEVTOOLS_APP__).toBeDefined()
    } finally {
      app.dispose()
    }
  })

  it('importing sygnal/devtools installs window.__SYGNAL_DEVTOOLS__ the way run() used to', async () => {
    const dev = await import('../dist/devtools.esm.js')
    const dt = window.__SYGNAL_DEVTOOLS__
    expect(dt).toBeDefined()
    expect(dt).toBe(dev.getDevTools())
    expect(core.getDevTools()).toBe(dt)
    expect(dt.connected).toBe(false)
    // getDiagnostics reads the app's diagnostics core (the external 'sygnal')
    expect(Array.isArray(dt.getDiagnostics())).toBe(true)

    // The core's hooks reach it: components register themselves
    const app = mount()
    const posted = []
    const realPost = window.postMessage.bind(window)
    window.postMessage = (msg, ...rest) => { if (msg?.source === '__SYGNAL_DEVTOOLS_PAGE__') posted.push(msg); else realPost(msg, ...rest) }
    try {
      expect([...dt._components.values()].some(m => m.name === 'App')).toBe(true)

      // The extension connects through window messages; a second install / init
      // must not add a second listener (one FULL_TREE per CONNECT)
      expect(dev.installDevTools()).toBe(dt)
      dt.init()
      window.dispatchEvent(new MessageEvent('message', { data: { source: EXT, type: 'CONNECT' }, source: window }))
      expect(dt.connected).toBe(true)
      expect(posted.filter(m => m.type === 'FULL_TREE')).toHaveLength(1)
      expect(posted[0].payload.components.some(c => c.name === 'App')).toBe(true)
    } finally {
      window.postMessage = realPost
      app.dispose()
      window.dispatchEvent(new MessageEvent('message', { data: { source: EXT, type: 'DISCONNECT' }, source: window }))
    }
  })
})
