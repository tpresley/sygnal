// 3E/R1: every value export of the built package must be usable outside Vite's CJS interop:
// in plain Node CommonJS (require of dist/index.cjs.js, the package "require" condition) and
// in native Node ESM (dist/index.esm.js, the "import" condition). The xstream/extra re-exports
// used to be `{ default: fn }` module objects there, and so were sygnal's internal uses of
// concat / dropRepeats / sampleCombine (withState, StateSource, the DOM driver).
//
// The probes run in a child `node` process so Vitest's own interop cannot mask the problem.
// SYGNAL_DIST_DIR overrides the dist directory (used to show the test fails on an old build).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import xs from 'xstream'
import * as ports from '../src/extra/xstreamExtras.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = process.env.SYGNAL_DIST_DIR || resolve(root, 'dist')
const cjsFile = resolve(dist, 'index.cjs.js')
const esmFile = resolve(dist, 'index.esm.js')

// Exports that are deliberately not functions.
const NON_FUNCTION_EXPORTS = { ABORT: 'symbol', onlineStatus$: 'object' }
const EXTRAS = ['concat', 'debounce', 'throttle', 'delay', 'dropRepeats', 'sampleCombine', 'flattenConcurrently', 'flattenSequentially']

// Shared probe body: `s` is the module namespace. Prints JSON {types, calls}.
const PROBE = `
  const types = {}
  for (const k of Object.keys(s)) if (k !== 'default' && k !== '__esModule') types[k] = typeof s[k]
  const calls = {}
  const xs = s.xs
  const done = () => process.stdout.write(JSON.stringify({ types, calls }))
  try {
    const out = []
    s.concat(xs.of(1), xs.of(2, 3)).addListener({ next: v => out.push(v) })
    calls.concat = out
  } catch (e) { calls.concat = 'THREW ' + e.message }
  try {
    const out = []
    xs.of(1, 2, 3).compose(s.debounce(5)).addListener({ next: v => out.push(v), complete: () => { calls.debounce = out; done() } })
  } catch (e) { calls.debounce = 'THREW ' + e.message; done() }
`

function runNode(args) {
  return JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
}

function check({ types, calls }) {
  const bad = Object.entries(types)
    .filter(([k, t]) => t !== (NON_FUNCTION_EXPORTS[k] || 'function'))
    .map(([k, t]) => `${k}: ${t}`)
  expect(bad).toEqual([])
  for (const name of EXTRAS) expect(types[name], name).toBe('function')
  expect(calls.concat).toEqual([1, 2, 3])
  expect(calls.debounce).toEqual([3])
}

describe('dist exports outside Vite interop (3E/R1)', () => {
  it.skipIf(!existsSync(cjsFile))('plain Node CJS: every value export is the right type; concat/debounce work', () => {
    check(runNode(['-e', `const s = require(${JSON.stringify(cjsFile)});` + PROBE]))
  })

  it.skipIf(!existsSync(esmFile))('native Node ESM: every value export is the right type; concat/debounce work', () => {
    const url = pathToFileURL(esmFile).href
    check(runNode(['--no-warnings', '--input-type=module', '-e', `import * as s from ${JSON.stringify(url)};` + PROBE]))
  })
})

// The ports must behave exactly like xstream/extra/* (same event order, errors, completion).
const trace = (s$, out) => s$.addListener({ next: v => out.push(v), error: e => out.push('E:' + e), complete: () => out.push('|') })
const sleep = ms => new Promise(r => setTimeout(r, ms))

describe('xstream extras ESM ports match xstream/extra (3E/R1)', () => {
  it('concat, dropRepeats and sampleCombine (synchronous)', async () => {
    const orig = {
      concat: (await import('xstream/extra/concat.js')).default,
      dropRepeats: (await import('xstream/extra/dropRepeats.js')).default,
      sampleCombine: (await import('xstream/extra/sampleCombine.js')).default,
    }
    const scenario = lib => {
      const out = []
      trace(lib.concat(xs.of(1), xs.empty(), xs.of(2, 3)), out)
      trace(xs.of(1, 1, 2, 2, 1).compose(lib.dropRepeats()), out)
      trace(xs.of({ a: 1 }, { a: 1 }, { a: 2 }).compose(lib.dropRepeats((x, y) => x.a === y.a)).map(o => o.a), out)
      trace(lib.concat(xs.of(1), xs.throw('boom'), xs.of(9)), out)
      const sampler = xs.create(), a = xs.create(), b = xs.create()
      trace(sampler.compose(lib.sampleCombine(a, b)), out)
      sampler.shamefullySendNext('s0') // dropped: a, b not yet emitted
      a.shamefullySendNext('a1'); sampler.shamefullySendNext('s1') // dropped: b missing
      b.shamefullySendNext('b1'); sampler.shamefullySendNext('s2')
      a.shamefullySendNext('a2'); a.shamefullySendComplete(); sampler.shamefullySendNext('s3')
      sampler.shamefullySendComplete()
      return out
    }
    expect(scenario(ports)).toEqual(scenario(orig))
    expect(scenario(ports)).toContain('|')
  })

  it('debounce, throttle and delay (timed)', async () => {
    const orig = {
      debounce: (await import('xstream/extra/debounce.js')).default,
      throttle: (await import('xstream/extra/throttle.js')).default,
      delay: (await import('xstream/extra/delay.js')).default,
    }
    const scenario = async lib => {
      const out = []
      const src = xs.create()
      trace(src.compose(lib.debounce(20)).map(v => 'd' + v), out)
      trace(src.compose(lib.throttle(20)).map(v => 't' + v), out)
      trace(src.compose(lib.delay(10)).map(v => 'w' + v), out)
      src.shamefullySendNext(1); src.shamefullySendNext(2)
      await sleep(40)
      src.shamefullySendNext(3)
      await sleep(5)
      src.shamefullySendNext(4)
      src.shamefullySendComplete()
      await sleep(40)
      return out
    }
    const a = await scenario(ports)
    const b = await scenario(orig)
    expect(a).toEqual(b)
  })
})
