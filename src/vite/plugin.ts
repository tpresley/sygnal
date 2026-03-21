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
 *   1. Configures esbuild for automatic JSX transform with sygnal as the import source
 *   2. Detects files that call `run()` from sygnal and auto-injects HMR wiring
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

  return {
    name: 'vite-plugin-sygnal',

    config(_config: any, env: { command: string }) {
      isServe = env.command === 'serve'

      if (disableJsx) return

      return {
        esbuild: {
          jsx: 'automatic' as const,
          jsxImportSource: 'sygnal',
        },
      }
    },

    transform(code: string, id: string) {
      if (disableHmr) return null
      if (!isServe) return null

      // Only transform JS/TS/JSX/TSX files
      if (!/\.[jt]sx?$/.test(id)) return null
      // Skip node_modules
      if (id.includes('node_modules')) return null
      // Must import run from sygnal
      if (!code.includes('sygnal')) return null
      // Skip if HMR is already manually wired
      if (code.includes('import.meta.hot')) return null

      // Find: import { run, ... } from 'sygnal'
      const runImportRe = /import\s+\{[^}]*\brun\b[^}]*\}\s+from\s+['"]sygnal['"]/
      if (!runImportRe.test(code)) return null

      // Find: run(ComponentName  — capture the component identifier
      const runCallMatch = code.match(
        /(?:(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=\s*)?run\s*\(\s*([A-Z]\w*)/
      )
      if (!runCallMatch) return null

      const componentName = runCallMatch[1]

      // Find the import path for this component
      // Handles: import App from './App.jsx'
      //          import App from "./App"
      const componentImportRe = new RegExp(
        `import\\s+${componentName}\\s+from\\s+['"]([^'"]+)['"]`
      )
      const componentImportMatch = code.match(componentImportRe)
      if (!componentImportMatch) return null

      const componentPath = componentImportMatch[1]

      // Determine how to access the run() result
      let transformed = code

      // Pattern 1: const { hmr, dispose, ... } = run(App, ...)
      const destructureMatch = code.match(
        /const\s+\{([^}]*)\}\s*=\s*run\s*\(/
      )
      if (destructureMatch) {
        const bindings = destructureMatch[1]
        const hasHmr = /\bhmr\b/.test(bindings)
        const hasDispose = /\bdispose\b/.test(bindings)

        if (hasHmr && hasDispose) {
          // Already has both bindings, just add hot.accept/dispose
          transformed += hmrBlock(componentPath, 'hmr', 'dispose')
          return { code: transformed, map: null }
        }
      }

      // Pattern 2: const app = run(App, ...)
      const varMatch = code.match(
        /(?:const|let|var)\s+(\w+)\s*=\s*run\s*\(/
      )
      if (varMatch) {
        const varName = varMatch[1]
        transformed += hmrBlock(componentPath, `${varName}.hmr`, `${varName}.dispose`)
        return { code: transformed, map: null }
      }

      // Pattern 3: bare run(App, ...) — no result captured
      // Replace the first run( with __sygnal = run(
      transformed = transformed.replace(
        /\brun\s*\(/,
        'const __sygnal = run('
      )
      transformed += hmrBlock(componentPath, '__sygnal.hmr', '__sygnal.dispose')
      return { code: transformed, map: null }
    },
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
