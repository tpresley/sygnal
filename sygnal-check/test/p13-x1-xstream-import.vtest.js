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
