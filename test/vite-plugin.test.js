import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import path from 'node:path'
import sygnal from '../dist/vite/plugin.mjs'

// G-099: xstream's `globalthis` resolves to the native-globalThis stub (nativeGlobalThis)
const RESOLVE = { alias: [{ find: /^globalthis$/, replacement: path.resolve('dist/shims/globalthis.cjs') }] }

const DEV_FLAG = 'if (globalThis.__SYGNAL_DEV__ === undefined) globalThis.__SYGNAL_DEV__ = true;'
// What a dev server (not Vitest) injects: the flag plus the dev checks and dev client
const SNIPPET = DEV_FLAG + "import 'sygnal/diagnostics';import 'virtual:sygnal/dev';"

// The plugin skips HMR wiring under Vitest (process.env.VITEST, read in
// config()). These tests run under Vitest, so configure as a plain dev server.
function serveConfig(plugin, { vitest = false, command = 'serve', config = {} } = {}) {
  const saved = process.env.VITEST
  if (vitest) process.env.VITEST = 'true'
  else delete process.env.VITEST
  try {
    // as Vite 8 calls it (Vite 7 also gets `esbuild`; see vite-plugin-jsx.test.js)
    return plugin.config.call({ meta: { viteVersion: '8.0.0' } }, config, { command })
  } finally {
    if (saved === undefined) delete process.env.VITEST
    else process.env.VITEST = saved
  }
}

// Minimal v3 sourcemap decoder: returns, per generated line, [genCol, srcLine, srcCol] segments
function decodeMappings(mappings) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let srcLine = 0, srcCol = 0
  return mappings.split(';').map(group => {
    let genCol = 0
    return group ? group.split(',').map(seg => {
      const vals = []
      let v = 0, shift = 0
      for (const ch of seg) {
        const d = B64.indexOf(ch)
        v += (d & 31) << shift
        if (d & 32) shift += 5
        else { vals.push(v & 1 ? -(v >>> 1) : v >>> 1); v = 0; shift = 0 }
      }
      genCol += vals[0]; srcLine += vals[2]; srcCol += vals[3]
      return [genCol, srcLine, srcCol]
    }) : []
  })
}

// Syntax errors of a transformed module (TypeScript parser; handles shebangs)
function parseErrors(code) {
  const sf = ts.createSourceFile('main.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  return sf.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

// Map a generated position back to the original via the decoded mappings
function originalPosition(decoded, line, col) {
  const segs = decoded[line] || []
  let best = null
  for (const s of segs) if (s[0] <= col) best = s
  return best && [best[1], best[2] + (col - best[0])]
}

describe('vite-plugin-sygnal', () => {
  describe('config', () => {
    it('returns jsx config by default', () => {
      const plugin = sygnal()
      const result = serveConfig(plugin)
      expect(result).toEqual({
        ssr: { noExternal: ['sygnal'] },
        resolve: RESOLVE,
        oxc: {
          jsx: {
            runtime: 'automatic',
            importSource: 'sygnal',
          },
        },
        // the dev dependency scanner doesn't read `oxc`
        optimizeDeps: {
          rolldownOptions: { transform: { jsx: { runtime: 'automatic', importSource: 'sygnal' } } },
          // B-020: the Vike client entry shares the pages' core
          exclude: ['sygnal/vike/onRenderClient'],
        },
      })
    })

    it('returns jsx config in build mode', () => {
      const plugin = sygnal()
      const result = serveConfig(plugin, { command: 'build' })
      expect(result).toEqual({
        ssr: { noExternal: ['sygnal'] },
        resolve: RESOLVE,
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
      const result = serveConfig(plugin)
      expect(result).toEqual({
        ssr: { noExternal: ['sygnal'] },
        resolve: RESOLVE,
        optimizeDeps: { exclude: ['sygnal/vike/onRenderClient'] },
      })
    })
  })

  describe('transform — HMR injection', () => {
    function createPlugin() {
      const plugin = sygnal()
      // Activate serve mode so transforms apply
      serveConfig(plugin)
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
      expect(result.code).toBe(SNIPPET + code)
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
      expect(result.code).toBe(SNIPPET + code)
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
      expect(result.code).toBe(SNIPPET + code)
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
      serveConfig(plugin)
      const code = `
import { run } from 'sygnal'
import App from './App.jsx'
run(App)
`
      const result = plugin.transform(code, '/src/main.js')
      expect(result.code).toBe(SNIPPET + code)
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
      serveConfig(plugin)
      return plugin
    }

    it('prepends the dev flag to the entry file in serve mode', () => {
      const result = servePlugin().transform(entry, '/src/main.js')
      expect(result.code.startsWith(DEV_FLAG)).toBe(true)
    })

    it('keeps line numbers unchanged (flag is on the first line)', () => {
      const result = servePlugin().transform(entry, '/src/main.js')
      const lines = result.code.split('\n')
      expect(lines[0]).toBe(SNIPPET + "import { run } from 'sygnal'")
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

    it('inserts the flag after a shebang line, keeping it first', () => {
      const code = `#!/usr/bin/env node\n${entry}`
      const result = servePlugin().transform(code, '/src/main.js')
      const lines = result.code.split('\n')
      expect(lines[0]).toBe('#!/usr/bin/env node')
      expect(lines[1]).toBe(SNIPPET + "import { run } from 'sygnal'")
      expect(parseErrors(result.code)).toEqual([])
    })

    it("inserts the flag after a 'use strict'; directive", () => {
      const code = `'use strict';\n${entry}`
      const result = servePlugin().transform(code, '/src/main.js')
      expect(result.code.split('\n')[0]).toBe(`'use strict';${SNIPPET}`)
      expect(parseErrors(result.code)).toEqual([])
    })

    it('inserts the flag after a directive prologue without semicolons (with comments)', () => {
      const code = `// header comment\n"use client"\n/* x */ 'use strict' // why\n${entry}`
      const result = servePlugin().transform(code, '/src/main.js')
      const lines = result.code.split('\n')
      expect(lines[1]).toBe('"use client"')
      expect(lines[2]).toBe(`/* x */ 'use strict';${SNIPPET} // why`)
      expect(parseErrors(result.code)).toEqual([])
    })

    it('a string expression that is not a directive does not move the flag', () => {
      const code = `'not' + 'a directive'\n${entry}`
      const result = servePlugin().transform(code, '/src/main.js')
      expect(result.code.startsWith(SNIPPET + "'not'")).toBe(true)
    })

    it('returns a sourcemap that maps every original line back to itself', () => {
      const code = `#!/usr/bin/env node\n'use strict'\n${entry}`
      const result = servePlugin().transform(code, '/src/main.js')
      expect(result.map.version).toBe(3)
      expect(result.map.sources).toEqual(['/src/main.js'])
      expect(result.map.sourcesContent).toEqual([code])
      const decoded = decodeMappings(result.map.mappings)
      const genLines = result.code.split('\n')
      const srcLines = code.split('\n')
      // `run(App)` (original line 4, col 0) is now `const __sygnal = run(App)`
      const runLine = srcLines.indexOf('run(App)')
      const genCol = genLines[runLine].indexOf('run(App)')
      expect(genCol).toBeGreaterThan(0)
      expect(originalPosition(decoded, runLine, genCol)).toEqual([runLine, 0])
      // the import after the flag maps back to column 0 of its own line
      const importCol = genLines[2].indexOf('import')
      expect(originalPosition(decoded, 2, importCol)).toEqual([2, 0])
      // a column inside the 'use strict' directive is unchanged
      expect(originalPosition(decoded, 1, 4)).toEqual([1, 4])
    })
  })

  describe('transform — HMR wiring robustness (B-007)', () => {
    function plugin() {
      const p = sygnal()
      serveConfig(p)
      return p
    }
    const head = `import { run } from 'sygnal'\nimport App from './App.jsx'\n`

    it('leaves an assignment to an existing variable untouched (dev flag only)', () => {
      const code = `${head}let app\napp = run(App)\n`
      const result = plugin().transform(code, '/src/main.js')
      expect(result.code).toBe(SNIPPET + code)
      expect(parseErrors(result.code)).toEqual([])
    })

    it('leaves nested and indented calls untouched (dev flag only)', () => {
      const variants = [
        `${head}export default run(App)\n`,
        `${head}start(run(App))\n`,
        `${head}const x = foo(run(App))\n`,
        `${head}function start() {\n  run(App)\n}\nstart()\n`,
        `${head}it('mounts', () => {\n  const app = run(App)\n  app.dispose()\n})\n`,
        `${head}const { hmr: h, dispose } = run(App)\n`,
        `${head}const { sources } = run(App)\n`,
      ]
      for (const code of variants) {
        const result = plugin().transform(code, '/src/main.js')
        expect(result.code, code).toBe(SNIPPET + code)
        expect(parseErrors(result.code), code).toEqual([])
      }
    })

    it('ignores run(App) inside comments and strings', () => {
      const variants = [
        `${head}// run(App)\n`,
        `${head}/*\nrun(App)\n*/\n`,
        `${head}const s = \`\nrun(App)\n\`\n`,
        `${head}// const app = run(App)\n`,
      ]
      for (const code of variants) {
        const result = plugin().transform(code, '/src/main.js')
        expect(result.code, code).toBe(SNIPPET + code)
        expect(parseErrors(result.code), code).toEqual([])
      }
    })

    it('wires the real call when a commented-out call comes first', () => {
      const code = `${head}// run(App)\nrun(App)\n`
      const result = plugin().transform(code, '/src/main.js')
      expect(result.code).toContain('// run(App)\nconst __sygnal = run(App)')
      expect(result.code).toContain("import.meta.hot.accept('./App.jsx', __sygnal.hmr)")
      expect(parseErrors(result.code)).toEqual([])
    })

    it('ignores a commented-out run import', () => {
      const code = `// import { run } from 'sygnal'\nimport { createElement } from 'sygnal'\nrun(App)\n`
      expect(plugin().transform(code, '/src/main.js')).toBeNull()
    })

    it('every wired shape parses and references a defined binding', () => {
      const variants = [
        [`${head}run(App)\n`, '__sygnal.hmr'],
        [`${head}const app = run(App)\n`, 'app.hmr'],
        [`${head}let app = run(App, {}, { mountPoint: '#app' })\n`, 'app.hmr'],
        [`${head}const { hmr, dispose, sources } = run(App)\n`, ', hmr)'],
      ]
      for (const [code, ref] of variants) {
        const result = plugin().transform(code, '/src/main.js')
        expect(result.code, code).toContain(ref)
        expect(parseErrors(result.code), code).toEqual([])
      }
    })

    it('skips HMR wiring in test files (dev flag only)', () => {
      const code = `${head}run(App)\n`
      for (const id of ['/src/app.test.js', '/src/app.spec.jsx', '/test/main.test.ts']) {
        expect(plugin().transform(code, id).code).toBe(SNIPPET + code)
      }
    })

    it('skips HMR wiring (and the dev flag, R9) under Vitest', () => {
      const p = sygnal()
      serveConfig(p, { vitest: true })
      const code = `${head}run(App)\n`
      expect(p.transform(code, '/src/main.js')).toBeNull()
    })
  })

  describe('plugin metadata', () => {
    it('has the correct name', () => {
      const plugin = sygnal()
      expect(plugin.name).toBe('vite-plugin-sygnal')
    })
  })
})
