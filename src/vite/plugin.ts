/**
 * Sygnal Vite Plugin
 *
 * Auto-configures JSX and wires up HMR with state preservation.
 *
 * Usage:
 *   import sygnal from 'sygnal/vite'
 *   export default defineConfig({ plugins: [sygnal()] })
 *
 * What it does:
 *   1. Configures OXC for automatic JSX transform with sygnal as the import source
 *   2. Detects files that call `run()` from sygnal and auto-injects HMR wiring
 *   3. In serve mode, marks the app as running in development by inserting
 *      `globalThis.__SYGNAL_DEV__ = true` (unless already defined) into every
 *      file that imports `run` from sygnal — including entries with manual HMR
 *      wiring or `disableHmr` — which turns on runtime diagnostics in 'warn'
 *      mode. Opt out with `run(App, drivers, { diagnostics: 'off' })`.
 *      The flag goes after any shebang line and directive prologue
 *      ('use strict', 'use client'), on an existing line (line numbers are
 *      unchanged), and the transform returns a sourcemap.
 *
 * Why not Vite's `define`? Vite's dependency optimizer does not apply user
 * `define` replacements to pre-bundled dependencies (only process.env.NODE_ENV),
 * so a `define` would never reach sygnal's own code when sygnal is pre-bundled.
 * Vite's client does copy `define` entries onto globalThis at runtime, but only
 * when `/@vite/client` is loaded (not under SSR or Vitest, where it would also
 * switch diagnostics on for every test run). Injecting the flag into the
 * entry file that calls run() is deterministic and scoped to the dev app; it
 * runs before run() is called, which is when the diagnostics mode is resolved.
 *
 * The HMR transform finds the pattern:
 *   import { run } from 'sygnal'
 *   import App from './App.jsx'
 *   run(App)
 *
 * And appends:
 *   if (import.meta.hot) {
 *     import.meta.hot.accept('./App.jsx', __sygnal.hmr)
 *     import.meta.hot.dispose(__sygnal.dispose)
 *   }
 *
 * HMR wiring is only added for a recognized top-level (column 0) run()
 * statement whose result reference is actually defined (see RUN_CALL_RE). It
 * is skipped — the dev flag is still injected — for any other shape (e.g.
 * `app = run(App)`, nested or indented calls), for test files (*.test.*,
 * *.spec.*) and under Vitest (process.env.VITEST).
 */

export interface SygnalPluginOptions {
  /**
   * Disable automatic JSX configuration.
   * Set to true if you want to configure JSX yourself.
   * @default false
   */
  disableJsx?: boolean

  /**
   * Disable automatic HMR wiring.
   * Set to true if you want to handle HMR manually.
   * @default false
   */
  disableHmr?: boolean
}

export default function sygnal(options: SygnalPluginOptions = {}) {
  const { disableJsx = false, disableHmr = false } = options
  let isServe = false
  let isVitest = false

  return {
    name: 'vite-plugin-sygnal',

    config(_config: any, env: { command: string }) {
      isServe = env.command === 'serve'
      isVitest = !!(globalThis as any).process?.env?.VITEST

      const config: any = {
        // Ensure sygnal is bundled for SSR rather than externalized.
        // Without this, Node fails to resolve sygnal's exports from
        // Vike's server chunks in production builds.
        ssr: {
          noExternal: ['sygnal'],
        },
      }

      if (!disableJsx) {
        config.oxc = {
          jsx: {
            runtime: 'automatic' as const,
            importSource: 'sygnal',
          },
        }
      }

      return config
    },

    transform(code: string, id: string) {
      if (!isServe) return null

      // Only transform JS/TS/JSX/TSX files
      if (!/\.[jt]sx?$/.test(id)) return null
      // Skip node_modules
      if (id.includes('node_modules')) return null
      // Must import run from sygnal
      if (!code.includes('sygnal')) return null

      // Match against the code with comments blanked out (same offsets), so
      // e.g. `// run(App)` or a commented-out import is never matched.
      const noComments = blankOut(code, false)

      // Find: import { run, ... } from 'sygnal'
      const runImportRe = /import\s+\{[^}]*\brun\b[^}]*\}\s+from\s+['"]sygnal['"]/
      if (!runImportRe.test(noComments)) return null

      // Dev flag: injected into every file that imports run() — also when HMR
      // wiring below is skipped. Inserted after any shebang line and directive
      // prologue, without adding a line.
      const inserts: Array<[number, string]> = [flagInsertion(code)]
      const done = (tail = '') => withSourcemap(code, inserts, tail, id)

      // Skip HMR wiring if disabled, in tests, or already manually wired
      if (disableHmr || isVitest || /\.(test|spec)\.[jt]sx?$/.test(id)) return done()
      if (noComments.includes('import.meta.hot')) return done()

      // Strings and template literals blanked out too: a statement-level match only
      const runCall = RUN_CALL_RE.exec(blankOut(code, true))
      if (!runCall) return done()
      const [, binding, componentName] = runCall

      // Find the import path for this component
      // Handles: import App from './App.jsx'
      //          import App from "./App"
      const componentImportRe = new RegExp(
        `import\\s+${componentName.replace(/\$/g, '\\$')}\\s+from\\s+['"]([^'"]+)['"]`
      )
      const componentImportMatch = noComments.match(componentImportRe)
      if (!componentImportMatch) return done()
      const componentPath = componentImportMatch[1]

      // Pattern 3: bare run(App, ...) — no result captured → const __sygnal = run(
      if (!binding) {
        inserts.push([runCall.index, 'const __sygnal = '])
        return done(hmrBlock(componentPath, '__sygnal.hmr', '__sygnal.dispose'))
      }

      // Pattern 2: const app = run(App, ...)
      if (binding[0] !== '{') {
        return done(hmrBlock(componentPath, `${binding}.hmr`, `${binding}.dispose`))
      }

      // Pattern 1: const { hmr, dispose, ... } = run(App, ...) — only when both
      // are bound under their own names (a rename would leave them undefined)
      const names = binding.slice(1, -1).split(',').map(s => s.trim())
      if (names.includes('hmr') && names.includes('dispose')) {
        return done(hmrBlock(componentPath, 'hmr', 'dispose'))
      }
      return done()
    },
  }
}

const DEV_FLAG = 'if (globalThis.__SYGNAL_DEV__ === undefined) globalThis.__SYGNAL_DEV__ = true;'

// A top-level (column 0) run(Component, ...) statement: bare, or declaring a
// new binding. Assignments to existing variables, nested calls and indented
// calls (e.g. inside a function or test callback) do not match (B-007). It is
// matched against the code with comments and strings blanked out.
const RUN_CALL_RE = /^(?:(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*)?run\s*\(\s*([A-Z][\w$]*)/m

// Comments, string literals and template literals (a regex literal containing
// a quote or `//` can over-blank; that only ever skips HMR wiring).
const COMMENT_OR_STRING_RE = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|(['"])(?:\\.|(?!\1)[^\\\n])*\1?|`(?:\\[\s\S]|[^\\`])*`?/g

/** Replace comments (and, with `strings`, string/template literals) by spaces, keeping offsets and newlines. */
function blankOut(code: string, strings: boolean): string {
  return code.replace(COMMENT_OR_STRING_RE, m =>
    !strings && m[0] !== '/' ? m : m.replace(/[^\n]/g, ' ')
  )
}

// One directive ('use strict', "use client", ...) with any leading whitespace
// and comments. It must end with `;` (group 2) or at the end of its line.
const DIRECTIVE_RE = /(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(['"])(?:\\.|(?!\1)[^\\\n])*\1(?:[ \t]*(;)|(?=[ \t]*(?:\/\/[^\n]*|\/\*[^\n]*?\*\/)?[ \t]*(?:\r?\n|$)))/y

/** Where to insert the dev flag: after a shebang line and the directive prologue. */
function flagInsertion(code: string): [number, string] {
  let at = code.startsWith('#!') ? (code.indexOf('\n') + 1 || code.length) : 0
  let semicolon = true
  DIRECTIVE_RE.lastIndex = at
  let m
  while ((m = DIRECTIVE_RE.exec(code))) {
    at = DIRECTIVE_RE.lastIndex
    semicolon = !!m[2]
  }
  return [at, (semicolon ? '' : ';') + DEV_FLAG]
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function vlq(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1
  let out = ''
  do {
    let digit = v & 31
    v >>>= 5
    if (v) digit |= 32
    out += B64[digit]
  } while (v)
  return out
}

/**
 * Apply single-line insertions (at offsets in the original code) plus an
 * appended tail, and build a v3 sourcemap without extra dependencies. No line
 * is added before the tail, so every original line maps to itself; on a line
 * with an insertion, the text after it maps back to its original column.
 */
function withSourcemap(code: string, inserts: Array<[number, string]>, tail: string, id: string) {
  inserts.sort((a, b) => a[0] - b[0])
  let out = ''
  let last = 0
  for (const [at, text] of inserts) {
    out += code.slice(last, at) + text
    last = at
  }
  out += code.slice(last) + tail

  let offset = 0
  let k = 0
  let prevLine = 0
  let prevCol = 0
  const mappings = code.split('\n').map((line, i) => {
    const segments: Array<[number, number]> = [[0, 0]]  // [generated column, original column]
    let shift = 0
    while (k < inserts.length && inserts[k][0] <= offset + line.length) {
      const col = inserts[k][0] - offset
      shift += inserts[k][1].length
      segments.push([col + shift, col])
      k++
    }
    offset += line.length + 1
    let genCol = 0
    return segments.map(([gen, col]) => {
      const seg = vlq(gen - genCol) + 'A' + vlq(i - prevLine) + vlq(col - prevCol)
      genCol = gen
      prevLine = i
      prevCol = col
      return seg
    }).join(',')
  }).join(';')

  return {
    code: out,
    map: { version: 3, sources: [id], sourcesContent: [code], names: [] as string[], mappings },
  }
}

function hmrBlock(componentPath: string, hmrRef: string, disposeRef: string): string {
  return `
if (import.meta.hot) {
  import.meta.hot.accept('${componentPath}', ${hmrRef})
  import.meta.hot.dispose(${disposeRef})
}
`
}
