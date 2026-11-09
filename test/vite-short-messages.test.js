// sygnal/vite productionMessages: the rewrite of the built core bundle (needs `npm run build`).
import fs from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { parseAst } from 'vite'
import { shortenMessages } from '../src/vite/shortMessages.ts'
import { formatDiagnostic } from '../src/extra/diagnostics/index.ts'

const dist = fs.readFileSync(new URL('../dist/index.esm.js', import.meta.url), 'utf8')

describe('shortenMessages', () => {
  const out = shortenMessages(dist, parseAst)

  it('applies to the built bundle: the texts and dbg calls are gone, codes and arguments stay', () => {
    expect(out).toBeTypeOf('string')
    expect(out).not.toContain('overwrites the initialState key')
    expect(out).not.toContain('Action triggered')
    expect(out).not.toContain('Sub-component threw')
    expect(out).toContain("warn('SYG207', name, \"\")")
    expect(out).toMatch(/error\('SYG406', this, "",void 0,e\)/)
    expect(() => parseAst(out)).not.toThrow()
  })

  it('keeps the line count', () => {
    expect(out.split('\n').length).toBe(dist.split('\n').length)
  })

  it('leaves a bundle it does not recognise alone', () => {
    expect(shortenMessages('const a = 1', parseAst)).toBe(null)
  })
})

describe('a rewritten bundle at run time', () => {
  it('prints the short form with the caught error, and a fail() throws it', async () => {
    const dir = new URL('../node_modules/.cache/', import.meta.url)
    fs.mkdirSync(dir, { recursive: true })
    const file = new URL('sygnal-short-messages.mjs', dir)
    fs.writeFileSync(file, shortenMessages(dist, parseAst))
    const { renderComponent } = await import(/* @vite-ignore */ file.href)

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('boom')
    const Thrower = () => { throw boom }
    Thrower.initialState = {}
    const t = renderComponent(Thrower)
    await t.ready()
    expect(logged).toHaveBeenCalledWith('[Sygnal SYG406] Thrower https://sygnal.js.org/reference/errors#syg406', boom)
    t.dispose()
    logged.mockRestore()

    const Bad = () => null
    Bad.calculated = 'not an object'
    expect(() => renderComponent(Bad)).toThrow('[Sygnal SYG606] Bad https://sygnal.js.org/reference/errors#syg606')
  })
})

describe('formatDiagnostic with a short message', () => {
  const url = 'https://sygnal.js.org/reference/errors#syg207'

  it('prints the code, the component and the docs URL', () => {
    expect(formatDiagnostic('SYG207', { component: 'Foo', message: '' })).toBe(`[Sygnal SYG207] Foo ${url}`)
    expect(formatDiagnostic('SYG207', { message: '' })).toBe(`[Sygnal SYG207] ${url}`)
  })

  it('is unchanged for a full message', () => {
    expect(formatDiagnostic('SYG207', { component: 'Foo', message: 'm', fix: 'f' })).toBe(`[Sygnal SYG207] Foo: m. f. ${url}`)
  })
})
