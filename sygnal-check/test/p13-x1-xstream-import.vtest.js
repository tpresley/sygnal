// PLAN-13 X-1: SYG302, a default import from 'xstream' (info, with a --fix)
import { describe, expect, it } from 'vitest'
import { checkFiles, fixFiles } from '../src/index.js'

const file = '/virtual/app/driver.js'
const run = (source) => checkFiles([file], { cwd: '/virtual/app', sources: { [file]: source } }).filter(d => d.code === 'SYG302')
const body = `\nexport const make = () => (sink$) => ({ select: () => xs.create() })\n`

describe('SYG302', () => {
  it("reports import xs from 'xstream' at info, with a fix to sygnal's xs", () => {
    const [d, ...rest] = run(`import xs from 'xstream'${body}`)
    expect(rest).toEqual([])
    expect(d).toMatchObject({ code: 'SYG302', severity: 'info', data: { local: 'xs' } })
    expect(d.fix).toContain("import { xs } from 'sygnal'")
    expect(d.fixes[0]).toMatchObject({ title: "Use import { xs } from 'sygnal'", fixAll: true })
  })

  it('--fix rewrites it (another local name keeps its name)', () => {
    for (const [src, want] of [[`import xs from 'xstream'`, `import { xs } from 'sygnal'`], [`import stream from "xstream";`, `import { xs as stream } from 'sygnal'`]]) {
      const out = fixFiles([file], { cwd: '/virtual/app', sources: { [file]: src + body } })
      expect(out.fixed).toBe(1)
      expect(out.texts.get(file)).toContain(want)
    }
  })

  it('no fix beside named imports; named, namespace and type-only imports are not reported', () => {
    const [d] = run(`import xs, { Stream } from 'xstream'${body}`)
    expect(d.fixes).toBeUndefined()
    expect(run(`import { Stream } from 'xstream'${body}`)).toEqual([])
    expect(run(`import type XS from 'xstream'${body}`.replace('driver.js', 'driver.ts'))).toEqual([])
    expect(run(`import { xs } from 'sygnal'${body}`)).toEqual([])
  })
})

it('--fix adds xs to an existing sygnal import instead of a second one', () => {
  const src = `import xs from 'xstream'\nimport { ABORT } from 'sygnal'${body}`
  const out = fixFiles([file], { cwd: '/virtual/app', sources: { [file]: src } })
  expect(out.texts.get(file)).toBe(`import { ABORT, xs } from 'sygnal'${body}`)
})

// Temper feedback 2026-10: the extras are CommonJS too
describe("SYG302 for 'xstream/extra/*'", () => {
  it('reports a default import of an extra, with a fix for the six sygnal exports', () => {
    const [d] = run(`import dropRepeats from 'xstream/extra/dropRepeats'${body}`)
    expect(d).toMatchObject({ code: 'SYG302', severity: 'info', data: { local: 'dropRepeats', extra: 'dropRepeats' } })
    expect(d.message).toContain('is not a function')
    expect(d.fixes[0].title).toBe("Use import { dropRepeats } from 'sygnal'")
    for (const [src, want] of [
      [`import dropRepeats from 'xstream/extra/dropRepeats'`, `import { dropRepeats } from 'sygnal'`],
      [`import dr from "xstream/extra/dropRepeats.js";`, `import { dropRepeats as dr } from 'sygnal'`],
      [`import sampleCombine from 'xstream/extra/sampleCombine'`, `import { sampleCombine } from 'sygnal'`],
    ]) {
      const out = fixFiles([file], { cwd: '/virtual/app', sources: { [file]: src + body } })
      expect(out.fixed).toBe(1)
      expect(out.texts.get(file)).toContain(want)
    }
    const out = fixFiles([file], { cwd: '/virtual/app', sources: { [file]: `import debounce from 'xstream/extra/debounce'\nimport { ABORT } from 'sygnal'${body}` } })
    expect(out.texts.get(file)).toBe(`import { ABORT, debounce } from 'sygnal'${body}`)
  })

  it('an extra sygnal does not export is reported without a fix; named and type imports are not', () => {
    const [d] = run(`import pairwise from 'xstream/extra/pairwise'${body}`)
    expect(d.fixes).toBeUndefined()
    expect(d.fix).toContain('pairwiseModule.default ?? pairwiseModule')
    expect(run(`import * as dr from 'xstream/extra/dropRepeats'${body}`)).toEqual([])
    expect(run(`import { dropRepeats } from 'sygnal'${body}`)).toEqual([])
    expect(run(`import 'xstream/extra/dropRepeats'${body}`)).toEqual([])
  })
})

describe('SYG303', () => {
  const comp = '/virtual/app/Tabs.jsx'
  const src = (imp, intent) => `${imp}
export default function Tabs({ state }) { return <div className="tabs">{state.tab}</div> }
Tabs.initialState = { tab: 'a' }
Tabs.intent = ${intent}
Tabs.model = { CHANGED: (s) => s }
`
  const check = (source, strict) => checkFiles([comp], { cwd: '/virtual/app', strict, sources: { [comp]: source } }).filter(d => d.code === 'SYG303')

  it('reports STATE.stream composed with dropRepeats(): info, warn under --strict, no fix', () => {
    const s = src(`import { dropRepeats } from 'sygnal'`, `({ STATE }) => ({ CHANGED: STATE.stream.map(s => s.tab).compose(dropRepeats()) })`)
    const [d, ...rest] = check(s)
    expect(rest).toEqual([])
    expect(d).toMatchObject({ code: 'SYG303', severity: 'info', component: 'Tabs' })
    expect(d.fix).toContain('STATE.watch')
    expect(d.fixes).toBeUndefined()
    const strict = check(s, true)
    expect(strict.map(x => x.severity)).toEqual(['warn'])
  })

  it('also through sources.STATE, the xstream extra and later operators', () => {
    expect(check(src(`import dropRepeats from 'xstream/extra/dropRepeats'\nimport { debounce } from 'sygnal'`,
      `(sources) => ({ CHANGED: sources.STATE.stream.map(s => s.tab).compose(dropRepeats()).compose(debounce(10)) })`))).toHaveLength(1)
  })

  it('leaves STATE.watch, another stream and a local dropRepeats alone', () => {
    expect(check(src(`import { dropRepeats } from 'sygnal'`, `({ STATE }) => ({ CHANGED: STATE.watch(s => s.tab) })`))).toEqual([])
    expect(check(src(`import { dropRepeats } from 'sygnal'`, `({ DOM }) => ({ CHANGED: DOM.input('.q').value().compose(dropRepeats()) })`))).toEqual([])
    expect(check(src(`const dropRepeats = () => (s) => s`, `({ STATE }) => ({ CHANGED: STATE.stream.compose(dropRepeats()) })`))).toEqual([])
  })
})
