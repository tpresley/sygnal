import { describe, it, expect } from 'vitest'
import sygnal from '../dist/vite/plugin.mjs'

describe('vite-plugin-sygnal', () => {
  describe('config', () => {
    it('returns jsx config by default', () => {
      const plugin = sygnal()
      const result = plugin.config({}, { command: 'serve' })
      expect(result).toEqual({
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: 'sygnal',
        },
      })
    })

    it('returns jsx config in build mode', () => {
      const plugin = sygnal()
      const result = plugin.config({}, { command: 'build' })
      expect(result).toEqual({
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: 'sygnal',
        },
      })
    })

    it('skips jsx config when disableJsx is true', () => {
      const plugin = sygnal({ disableJsx: true })
      const result = plugin.config({}, { command: 'serve' })
      expect(result).toBeUndefined()
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

    it('skips files that already have import.meta.hot', () => {
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
      expect(result).toBeNull()
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

    it('skips files where run is called with a non-component (lowercase)', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'

run(someFunction)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).toBeNull()
    })

    it('skips files where component has no import path', () => {
      const plugin = createPlugin()
      const code = `
import { run } from 'sygnal'

function App({ state }) { return <div>{state.count}</div> }
App.initialState = { count: 0 }

run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      // App is defined inline, not imported — can't wire HMR to a module
      expect(result).toBeNull()
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

    it('skips when disableHmr is true', () => {
      const plugin = sygnal({ disableHmr: true })
      plugin.config({}, { command: 'serve' })
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result).toBeNull()
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

  describe('plugin metadata', () => {
    it('has the correct name', () => {
      const plugin = sygnal()
      expect(plugin.name).toBe('vite-plugin-sygnal')
    })
  })
})
