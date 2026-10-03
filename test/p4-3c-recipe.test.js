// @vitest-environment jsdom
// PLAN-4 3-C (GS-7): the docs recipe for timers (a stopwatch), run verbatim (PLAN-4 §1.4).
// RECIPE is the exact code block for the docs (4-B copies it): compiled with the automatic JSX
// runtime (jsxImportSource 'sygnal', as sygnal/vite does), imported against the built package
// (dist: run `npm run build` first), exercised with renderComponent on fake timers, and checked
// with `sygnal-check --strict` (strict-clean and a11y-clean).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))

// ── guide/timers: stopwatch ─────────────────────────────────────────────────
export const RECIPE = `import { controls } from 'sygnal'

const { Toggle, Lap, Reset } = controls({ Toggle: 'button', Lap: 'button', Reset: 'button' })

const pad = (n) => String(n).padStart(2, '0')
const format = (ms) => {
  const tenths = Math.floor(ms / 100)
  return \`\${pad(Math.floor(tenths / 600))}:\${pad(Math.floor(tenths / 10) % 60)}.\${tenths % 10}\`
}

// the running time at clock time \`at\`: the finished runs plus the current one
const elapsed = (state, at) => state.done + (state.status === 'running' ? at - state.since : 0)

export function Stopwatch({ state }) {
  const label = { idle: 'Start', running: 'Pause', paused: 'Resume' }[state.status]
  return (
    <section className="stopwatch">
      <p className="time">{format(elapsed(state, state.now))}</p>
      <Toggle>{label}</Toggle>
      <Lap disabled={state.status !== 'running'}>Lap</Lap>
      <Reset disabled={state.status !== 'paused'}>Reset</Reset>
      <ol className="laps">
        {state.laps.map((lap, i) => <li>{\`Lap \${i + 1}: \${format(lap)}\`}</li>)}
      </ol>
    </section>
  )
}

const INITIAL = { status: 'idle', done: 0, since: 0, now: 0, lapStart: 0, laps: [] }

Stopwatch.initialState = INITIAL
// a tick every 100 ms while running; stopped when it pauses, resets or unmounts
Stopwatch.timers = (state) => ({ tick: state.status === 'running' && { every: 100, action: 'TICK' } })
Stopwatch.intent = ({ DOM }) => ({
  TOGGLE: DOM.click(Toggle).map(() => Date.now()),
  LAP: DOM.click(Lap).map(() => Date.now()),
  RESET: DOM.click(Reset),
})
Stopwatch.model = {
  TOGGLE: (state, at) => state.status === 'running'
    ? { ...state, status: 'paused', done: elapsed(state, at), now: at }
    : { ...state, status: 'running', since: at, now: at },
  TICK: (state, { t }) => ({ ...state, now: t }),
  LAP: (state, at) => {
    const total = elapsed(state, at)
    return { ...state, now: at, laps: [...state.laps, total - state.lapStart], lapStart: total }
  },
  RESET: () => INITIAL,
}
`

let dir, mod
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(here, '.p4-3c-recipe-'))
  fs.writeFileSync(path.join(dir, 'stopwatch.jsx'), RECIPE)
  // (esbuild can't run under jsdom; TypeScript's transpiler gives the same automatic-runtime output)
  const { outputText: code } = ts.transpileModule(RECIPE, { fileName: 'stopwatch.jsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, allowJs: true,
  } })
  fs.writeFileSync(path.join(dir, 'stopwatch.mjs'), code)
  mod = await import(pathToFileURL(path.join(dir, 'stopwatch.mjs')).href)
})
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; vi.useRealTimers() })

const advance = (ms) => vi.advanceTimersByTimeAsync(ms)
// as the eval's helpers: each click lets 50 ms pass
const click = async (control) => { t.simulateEvent(`[data-control="${control}"]`, 'click'); await advance(50) }
const time = () => t.query('.time').textContent
const laps = () => t.queryAll('.laps li').map(li => li.textContent)

describe('the recipe is strict-clean and a11y-clean (sygnal-check --strict)', () => {
  it('stopwatch', () => {
    const d = checkFiles([path.join(dir, 'stopwatch.jsx')], { cwd: dir, strict: true })
    // the timer action TICK is a trigger (PLAN-4 3-K): no SYG102
    expect(d.map(x => `${x.code} ${x.message}`)).toEqual([])
  })
})

// the clock times the clicks reached the model (the intent maps each to Date.now())
const at = (type) => t.actions.filter(a => a.type === type).map(a => a.data)
const fmt = (ms) => {
  const tenths = Math.floor(ms / 100), pad = (n) => String(n).padStart(2, '0')
  return `${pad(Math.floor(tenths / 600))}:${pad(Math.floor(tenths / 10) % 60)}.${tenths % 10}`
}

describe('stopwatch recipe', () => {
  it('start, pause, resume (no time lost), laps, reset; no timer while not running', async () => {
    vi.useFakeTimers()
    t = renderComponent(mod.Stopwatch, { dom: 'real' })
    await t.ready()
    expect(time()).toBe('00:00.0')
    expect(t.timers()).toEqual([])
    await click('Toggle')                     // start
    expect(t.timers()).toEqual([{ name: 'tick', every: 100, action: 'TICK', component: 'Stopwatch' }])
    expect(t.query('[data-control="Toggle"]').textContent).toBe('Pause')
    await advance(1150)
    await click('Lap')                        // lap 1
    const lap1 = at('LAP')[0] - at('TOGGLE')[0]
    await advance(40)
    await click('Toggle')                     // pause: the display shows the exact running time
    let [s1, p1] = at('TOGGLE')
    expect(time()).toBe(fmt(p1 - s1))
    expect(t.query('[data-control="Toggle"]').textContent).toBe('Resume')
    expect(t.timers()).toEqual([])
    const ticks = at('TICK').length
    await advance(5000)
    expect(at('TICK').length).toBe(ticks)     // nothing ticks while paused
    expect(time()).toBe(fmt(p1 - s1))
    await click('Toggle')                     // resume
    await advance(910)
    await click('Toggle')                     // pause: both runs, the pause not counted
    const [, , s2, p2] = at('TOGGLE')
    expect(time()).toBe(fmt(p1 - s1 + p2 - s2))
    await click('Toggle')                     // resume
    await advance(300)
    await click('Lap')                        // lap 2: its own running time
    const [, , , , s3] = at('TOGGLE')
    const lap2 = (p1 - s1) + (p2 - s2) + (at('LAP')[1] - s3) - lap1
    expect(laps()).toEqual([`Lap 1: ${fmt(lap1)}`, `Lap 2: ${fmt(lap2)}`])
    // while running the display is at most one tick (100 ms) behind
    const running = (p1 - s1) + (p2 - s2) + (Date.now() - s3)
    expect([fmt(running), fmt(running - 100)]).toContain(time())
    await click('Toggle')
    await click('Reset')
    expect(time()).toBe('00:00.0')
    expect(laps()).toEqual([])
    expect(t.query('[data-control="Toggle"]').textContent).toBe('Start')
    expect(t.timers()).toEqual([])
    t.expectNoDiagnostics()
  })

  it('no drift over 1,000 ticks; unmounting leaves no timer', async () => {
    vi.useFakeTimers()
    t = renderComponent(mod.Stopwatch, { dom: 'real' })
    await t.ready()
    await click('Toggle')
    const [s] = at('TOGGLE')
    await advance(s + 100_000 - Date.now())   // exactly 100 s after the start
    const ticks = at('TICK')
    expect(ticks).toHaveLength(1000)
    expect(ticks.at(-1)).toEqual({ n: 1000, t: s + 100_000 })
    expect(ticks.every((x, i) => x.t === s + (i + 1) * 100)).toBe(true)
    await advance(20)                         // the patch of the last tick's render (an animation frame)
    expect(time()).toBe('01:40.0')
    await click('Toggle')                     // pause, resume, unmount while running
    await click('Toggle')
    t.dispose()
    t = null
    await advance(100)
    expect(vi.getTimerCount()).toBe(0)
  })
})
