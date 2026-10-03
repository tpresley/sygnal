/**
 * Drift guard for the error reference (src/explanations.js): every code in the
 * runtime registry (src/extra/diagnostics/codes.ts: CODE_SEVERITY, CODE_TITLES,
 * STRICT_CODE_SEVERITY, DEV_CODE_SEVERITY) has exactly one entry with the same title and default
 * severity; every code sygnal-check reports is covered; explanations.json
 * matches the table. Read as text so the package has no runtime dependency on
 * sygnal.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPLANATIONS } from '../src/explanations.js'
import { CODES } from '../src/codes.js'
import { getExplanation, listExplanations, formatExplanation } from '../src/explain.js'
import { main } from '../src/cli.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const registry = fs.readFileSync(path.resolve(pkgRoot, '../src/extra/diagnostics/codes.ts'), 'utf8')

function table(name) {
  const block = new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(registry)
  if (!block) throw new Error(`${name} not found in codes.ts`)
  const out = {}
  const re = /^\s*(SYG\d{3})\s*:\s*(['"])((?:\\.|(?!\2).)*)\2\s*,?\s*$/gm
  let m
  while ((m = re.exec(block[1]))) out[m[1]] = m[3].replace(/\\(.)/g, '$1')
  return out
}

const titles = table('CODE_TITLES')
const severities = { ...table('CODE_SEVERITY'), ...table('STRICT_CODE_SEVERITY'), ...table('DEV_CODE_SEVERITY') }
const registered = Object.keys({ ...titles, ...severities }).sort()

function run(args) {
  let out = ''
  let err = ''
  const code = main(args, { cwd: pkgRoot, stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } } })
  return { code, out, err }
}

describe('explanations table', () => {
  it('parses the runtime registry', () => {
    expect(registered.length).toBeGreaterThan(60)
  })

  it('covers exactly the registered codes', () => {
    expect(Object.keys(EXPLANATIONS).sort()).toEqual(registered)
  })

  for (const code of registered) {
    it(`${code}: same title and severity as the registry; explanation and fix present`, () => {
      const e = EXPLANATIONS[code]
      expect(e, `${code} has no explanation`).toBeDefined()
      expect(e.title).toBe(titles[code])
      expect(e.severity).toBe(severities[code])
      expect(e.reportedBy.length).toBeGreaterThan(0)
      for (const r of e.reportedBy) expect(['runtime', 'dev-entry', 'static']).toContain(r)
      expect(e.explanation.length).toBeGreaterThan(80)
      expect(e.fix.length).toBeGreaterThan(20)
    })
  }

  it('every code sygnal-check reports is marked as static (and vice versa for its CODES table)', () => {
    for (const code of Object.keys(CODES)) expect(EXPLANATIONS[code].reportedBy, code).toContain('static')
    for (const [code, e] of Object.entries(EXPLANATIONS)) {
      if (e.reportedBy.includes('static')) expect(CODES[code], code).toBeDefined()
    }
  })

  it('explanations.json is up to date (regenerate: node bin/sygnal-check.js explain --all --json > explanations.json)', () => {
    const json = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'explanations.json'), 'utf8'))
    expect(json).toEqual(listExplanations())
  })
})

describe('sygnal-check explain', () => {
  it('prints title, severity, explanation, fix and docs URL', () => {
    const r = run(['explain', 'SYG104'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^SYG104: Intent selector crosses an isolation boundary\n {2}severity: warn\n/)
    expect(r.out).toContain('Fix:')
    expect(r.out).toContain('https://sygnal.js.org/reference/errors#syg104')
  })

  it('accepts syg104 / 104, shows the static severity when it differs, and --json', () => {
    expect(run(['explain', '104']).out).toBe(run(['explain', 'syg104']).out)
    expect(run(['explain', 'SYG102']).out).toContain('severity: info (sygnal-check: warn)')
    const e = JSON.parse(run(['explain', 'SYG507', '--json']).out)
    expect(e).toEqual(getExplanation('SYG507'))
    expect(e).toMatchObject({ code: 'SYG507', severity: 'info', strict: true, docsUrl: 'https://sygnal.js.org/reference/errors#syg507' })
  })

  it('--all lists every code', () => {
    const list = JSON.parse(run(['explain', '--all', '--json']).out)
    expect(list.map(e => e.code)).toEqual(registered)
    expect(run(['explain', '--all']).out).toContain(formatExplanation(getExplanation('SYG900')))
  })

  it('unknown codes and bad usage exit 2', () => {
    const r = run(['explain', 'SYG199'])
    expect(r.code).toBe(2)
    expect(r.err).toContain("unknown code 'SYG199'")
    expect(r.err).toContain('SYG101')
    expect(run(['explain']).code).toBe(2)
    expect(run(['explain', 'SYG101', '--bogus']).code).toBe(2)
  })
})
