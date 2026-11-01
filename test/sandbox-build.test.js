// sygnal/sandbox's packaging (D209): the guest kernel is built from the installed packages by
// buildSandboxKernel() (Vite, esbuild, Rollup) and by sygnal/vite (`sygnal/sandbox/kernel?raw`),
// never shipped prebuilt; the entries keep 'sygnal' and the QuickJS peers external; SSR prints the
// first render through the allowlist, a fresh instance per call.
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSandboxKernel } from '../src/sandbox/build.ts'
import { renderToHTML, treeToHTML } from '../src/sandbox.ts'

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')
const read = (f) => fs.readFileSync(path.join(dist, f), 'utf8')
// import / export statements, require() and import() calls (not the text of comments or messages)
const imports = (src) => [...src.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').matchAll(/^\s*(?:import|export)\b[^'"]*?['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\)|\bimport\(\s*['"]([^'"]+)['"]\)/gm)].map((m) => m[1] || m[2] || m[3]).filter((s) => !s.startsWith('.') && !s.startsWith('node:'))
const COUNTER = `var h = __h;
function C(p) { return h('div', { className: 'c', id: 'main' }, h('span', null, String(p.state.n)), h('a', { href: 'javascript:alert(1)' }, 'x')) }
C.initialState = { n: 7 };
module.exports.default = C;`

describe('sygnal/sandbox: the kernel, built from the installed packages', () => {
  const kernels = {}
  beforeAll(async () => {
    for (const bundler of ['esbuild', 'rollup', 'vite']) kernels[bundler] = await buildSandboxKernel({ root, bundler })
  }, 60_000)

  it('each bundler makes a kernel that boots and renders (SSR through the allowlist)', async () => {
    for (const [bundler, kernel] of Object.entries(kernels)) {
      expect(kernel, bundler).toMatch(/^var global = globalThis;/)
      expect(kernel, bundler).not.toContain('process.env.NODE_ENV')
      const { html, violations } = await renderToHTML({ kernel, source: COUNTER })
      expect(html, bundler).toBe('<div class="c" id="sbx-main"><span>7</span><a>x</a></div>')
      expect(violations).toEqual(['href javascript:alert(1)'])
    }
  })

  it('the kernel bundles xstream and snabbdom from node_modules, and no globalthis polyfill chain', () => {
    expect(kernels.vite).toMatch(/shamefullySendNext/)
    expect(kernels.vite).not.toMatch(/get-intrinsic|GetIntrinsic/)
    // nothing in dist/ ships them prebuilt: the kernel entry imports them by name
    expect(new Set(imports(read('sandbox-kernel.esm.js')))).toEqual(new Set(['sygnal', 'sygnal/host']))
  })

  it('SSR: a fresh runtime (and instance) per call; tenants share nothing', async () => {
    const kernel = kernels.esbuild
    const setter = `globalThis.leak = 'tenant A'; ${COUNTER}`
    const reader = `var h = __h; function R() { return h('p', null, String(typeof globalThis.leak)) } R.initialState = {}; module.exports.default = R;`
    await renderToHTML({ kernel, source: setter })
    expect((await renderToHTML({ kernel, source: reader })).html).toBe('<p>undefined</p>')
    await expect(renderToHTML({ kernel, source: 'for (;;) {}', limits: { bootMs: 50 } })).rejects.toMatchObject({ reason: 'timeout' })
    expect(treeToHTML([{ i: 1, t: 'p', a: { class: 'a b' }, c: [] }], { policy: { classPrefix: 'g-' } }).html).toBe('<p class="g-a g-b"></p>')
  })
})

describe('sygnal/sandbox: entries (D209)', () => {
  it('sygnal/sandbox: the external core and the optional peers only', () => {
    for (const f of ['sandbox.esm.js', 'sandbox.cjs.js']) {
      expect(new Set(imports(read(f)))).toEqual(new Set(['sygnal', 'quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync']))
      expect(read(f)).not.toMatch(/class App\b|createElementWithModules|class HostElement/)
    }
    for (const f of ['sandbox-worker.esm.js', 'sandbox-worker.cjs.js'])
      expect(new Set(imports(read(f)))).toEqual(new Set(['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync']))
    for (const f of ['sandbox-build.esm.js', 'sandbox-build.cjs.js']) expect(imports(read(f))).toEqual([])
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    for (const p of ['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync']) {
      expect(pkg.peerDependencies[p]).toBe('~0.32.0')
      expect(pkg.peerDependenciesMeta[p]).toEqual({ optional: true })
      expect(pkg.dependencies[p]).toBe(undefined)
    }
  })

  it('load in plain Node, ESM and CommonJS: a thread sandbox renders to HTML', () => {
    const kernelFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-kernel-')), 'k.js')
    fs.writeFileSync(kernelFile, buildKernelSync())
    const src = JSON.stringify(COUNTER)
    const esm = execFileSync(process.execPath, ['--input-type=module', '-e', `import {renderToHTML} from 'sygnal/sandbox'; import fs from 'node:fs'; const r = await renderToHTML({ kernel: fs.readFileSync(${JSON.stringify(kernelFile)}, 'utf8'), source: ${src} }); console.log(r.html)`], { cwd: root, encoding: 'utf8' })
    expect(esm.trim()).toBe('<div class="c" id="sbx-main"><span>7</span><a>x</a></div>')
    const cjs = execFileSync(process.execPath, ['-e', `const {renderToHTML} = require('sygnal/sandbox'); renderToHTML({ kernel: require('fs').readFileSync(${JSON.stringify(kernelFile)}, 'utf8'), source: ${src} }).then(r => console.log(r.html))`], { cwd: root, encoding: 'utf8' })
    expect(cjs.trim()).toBe(esm.trim())
  })
})

function buildKernelSync() {
  return execFileSync(process.execPath, ['--input-type=module', '-e', "import {buildSandboxKernel} from 'sygnal/sandbox/build'; process.stdout.write(await buildSandboxKernel({ bundler: 'esbuild' }))"], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
}

describe('sygnal/vite: sygnal/sandbox/kernel?raw', () => {
  let js = '', files = []
  beforeAll(() => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-sandbox-app-'))
    const env = { ...process.env }
    for (const k of Object.keys(env)) if (k.startsWith('VITEST') || k === 'NODE_ENV') delete env[k]
    execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', path.join(root, 'test/fixtures/sandbox-app'), '--outDir', out], { env, stdio: 'pipe' })
    files = fs.readdirSync(path.join(out, 'assets'))
    js = files.filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(out, 'assets', f), 'utf8')).join('\n')
    fs.rmSync(out, { recursive: true, force: true })
  }, 60_000)

  it('the app gets the kernel as a string, the default worker as its own chunk, the .wasm as an asset', () => {
    expect(js).toContain('var global = globalThis;')
    expect(js).toMatch(/__sandboxTimers/)
    expect(files.some((f) => /^sandbox-worker\.esm-.*\.js$/.test(f))).toBe(true)
    expect(files.some((f) => f.endsWith('.wasm'))).toBe(true)
  })
})
