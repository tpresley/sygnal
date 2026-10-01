import { describe, it, expect } from 'vitest'
import sygnal from '../dist/vite/plugin.mjs'

const DEV_FLAG = 'if (globalThis.__SYGNAL_DEV__ === undefined) globalThis.__SYGNAL_DEV__ = true;'

describe('vite-plugin-sygnal', () => {
  describe('config', () => {
    it('returns jsx config by default', () => {
      const plugin = sygnal()
      const result = plugin.config({}, { command: 'serve' })
      expect(result).toEqual({
        ssr: { noExternal: ['sygnal'] },
        oxc: {
          jsx: {
            runtime: 'automatic',
            importSource: 'sygnal',
          },
        },
      })
    })

    it('returns jsx config in build mode', () => {
      const plugin = sygnal()
      const result = plugin.config({}, { command: 'build' })
      expect(result).toEqual({
        ssr: { noExternal: ['sygnal'] },
        oxc: {
          jsx: {
            runtime: 'automatic',
            importSource: 'sygnal',
          },
        },
      })
    })

    it('skips jsx config when disableJsx is true', () => {
      const plugin = sygnal({ disableJsx: true })
      const result = plugin.config({}, { command: 'serve' })
      expect(result).toEqual({
        ssr: { noExternal: ['sygnal'] },
      })
    })
  })

  describe('transform — HMR injection', () => {
    function createPlugin() {
      const plugin = sygnal()
      // Activate serve mode so transforms apply
      plugin.config({}, { command: 'serve' })
      return plugin
    }

    it('injects HMR for bare run() call', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'

run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).not.toBeNull()
      expect(result.code).toContain('const __sygnal = run(')
      expect(result.code).toContain("import.meta.hot.accept('./App.jsx', __sygnal.hmr)")
      expect(result.code).toContain('import.meta.hot.dispose(__sygnal.dispose)')
    })

    it('injects HMR for const app = run() pattern', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'

const app = run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).not.toBeNull()
      expect(result.code).toContain("import.meta.hot.accept('./App.jsx', app.hmr)")
      expect(result.code).toContain('import.meta.hot.dispose(app.dispose)')
      // Should NOT modify the original run() call
      expect(result.code).toContain('const app = run(App)')
    })

    it('injects HMR for destructured { hmr, dispose } = run()', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'

const { hmr, dispose } = run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).not.toBeNull()
      expect(result.code).toContain("import.meta.hot.accept('./App.jsx', hmr)")
      expect(result.code).toContain('import.meta.hot.dispose(dispose)')
    })

    it('works with run() that has drivers and options', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'

const app = run(App, { DND: makeDragDriver() }, { mountPoint: '#app' })
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).not.toBeNull()
      expect(result.code).toContain("import.meta.hot.accept('./App.jsx', app.hmr)")
    })

    it('works with double-quoted import paths', () => {
      const plugin = createPlugin()
      const code = `
import { run } from "sygnal"
import App from "./App.jsx"

run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).not.toBeNull()
      expect(result.code).toContain('import.meta.hot.accept')
    })

    it('works with .tsx component paths', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './components/App.tsx'

const app = run(App)
`
      const result = plugin.transform(code, '/src/main.ts')
      expect(result).not.toBeNull()
      expect(result.code).toContain("import.meta.hot.accept('./components/App.tsx', app.hmr)")
    })

    it('works with extensionless import paths', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './App'

run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).not.toBeNull()
      expect(result.code).toContain("import.meta.hot.accept('./App', __sygnal.hmr)")
    })

    it('skips HMR wiring for files that already have import.meta.hot (dev flag only)', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'

const { hmr, dispose } = run(App)

if (import.meta.hot) {
  import.meta.hot.accept('./App.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).toEqual({ code: DEV_FLAG + code })
    })

    it('skips files without run import from sygnal', () => {
      const plugin = createPlugin()
      const code = `
import { createElement } from 'sygnal'
import App from './App.jsx'

function render() { return createElement('div', null, 'hello') }
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).toBeNull()
    })

    it('skips HMR wiring where run is called with a non-component (dev flag only)', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'

run(someFunction)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).toEqual({ code: DEV_FLAG + code })
    })

    it('skips HMR wiring where component has no import path (dev flag only)', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'

function App({ state }) { return <div>{state.count}</div> }
App.initialState = { count: 0 }

run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      // App is defined inline, not imported — can't wire HMR to a module, but the dev flag is still set
      expect(result).toEqual({ code: DEV_FLAG + code })
    })

    it('skips node_modules', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`
      const result = plugin.transform(code, '/node_modules/some-pkg/main.js')
      expect(result).toBeNull()
    })

    it('skips non-js files', () => {
      const plugin = createPlugin()
      const result = plugin.transform('some css', '/src/styles.css')
      expect(result).toBeNull()
    })

    it('skips in build mode (not serve)', () => {
      const plugin = sygnal()
      plugin.config({}, { command: 'build' })
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).toBeNull()
    })

    it('skips HMR wiring when disableHmr is true (dev flag only)', () => {
      const plugin = sygnal({ disableHmr: true })
      plugin.config({}, { command: 'serve' })
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).toEqual({ code: DEV_FLAG + code })
    })

    it('handles run with multiple sygnal imports', () => {
      const plugin = createPlugin()
      const code = `
import { run, createElement, createCommand } from 'sygnal'
import App from './App.jsx'

const cmd = createCommand()
run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).not.toBeNull()
      expect(result.code).toContain("import.meta.hot.accept('./App.jsx', __sygnal.hmr)")
    })
  })

  describe('transform — dev flag (__SYGNAL_DEV__)', () => {
    const entry = `import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`

    function servePlugin(opts) {
      const plugin = sygnal(opts)
      plugin.config({}, { command: 'serve' })
      return plugin
    }

    it('prepends the dev flag to the entry file in serve mode', () => {
      const result = servePlugin().transform(entry, '/src/main.js')
      expect(result.code.startsWith(DEV_FLAG)).toBe(true)
    })

    it('keeps line numbers unchanged (flag is on the first line)', () => {
      const result = servePlugin().transform(entry, '/src/main.js')
      const lines = result.code.split('\n')
      expect(lines[0]).toBe(DEV_FLAG + "import { run } from 'sygnal'")
      expect(lines[1]).toBe("import App from './App.jsx'")
    })

    it('injects the flag for every run() result pattern', () => {
      const plugin = servePlugin()
      const variants = [
        `import { run } from 'sygnal'\nimport App from './App.jsx'\nconst app = run(App)\n`,
        `import { run } from 'sygnal'\nimport App from './App.jsx'\nconst { hmr, dispose } = run(App)\n`,
      ]
      for (const code of variants) {
        expect(plugin.transform(code, '/src/main.js').code.startsWith(DEV_FLAG)).toBe(true)
      }
    })

    it('respects a value the app already set (only assigns when undefined)', () => {
      const result = servePlugin().transform(entry, '/src/main.js')
      const g = {}
      g.__SYGNAL_DEV__ = false
      // evaluate just the flag statement against a fake globalThis
      new Function('globalThis', DEV_FLAG)(g)
      expect(g.__SYGNAL_DEV__).toBe(false)
      const g2 = {}
      new Function('globalThis', DEV_FLAG)(g2)
      expect(g2.__SYGNAL_DEV__).toBe(true)
      expect(result.code).toContain(DEV_FLAG)
    })

    it('does not inject in build mode', () => {
      const plugin = sygnal()
      plugin.config({}, { command: 'build' })
      expect(plugin.transform(entry, '/src/main.js')).toBeNull()
    })

    it('does not inject into non-entry files', () => {
      const code = `import { createElement } from 'sygnal'\nexport default function App() {}\n`
      expect(servePlugin().transform(code, '/src/App.jsx')).toBeNull()
    })

    it('does not use define (it would not reach pre-bundled sygnal)', () => {
      const result = sygnal().config({}, { command: 'serve' })
      expect(result.define).toBeUndefined()
    })
  })

  describe('plugin metadata', () => {
    it('has the correct name', () => {
      const plugin = sygnal()
      expect(plugin.name).toBe('vite-plugin-sygnal')
    })
  })
})
