/**
 * PLAN-4 2-A2 type tests: the Astro integration's onError module option (D120), the uid root (G-206). Compiled by
 * `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import sygnalAstro from 'sygnal/astro'
import type { SygnalAstroOptions } from 'sygnal/astro'
import { run, renderToString } from 'sygnal'
import type { RunOptions, RenderToStringOptions } from 'sygnal'

describe('G-206: uid root', () => {
  it('is a string option of run() and renderToString()', () => {
    expectTypeOf<RunOptions['uid']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<RenderToStringOptions['uid']>().toEqualTypeOf<string | undefined>()
    function App() { return <div /> }
    run(App, {}, { mountPoint: '#signup', uid: 'signup' })
    renderToString(App, { uid: 'signup' })
    // @ts-expect-error — a string
    run(App, {}, { uid: 2 })
  })
})

describe('D120: Astro onError', () => {
  it('is a module path option of the integration', () => {
    expectTypeOf<SygnalAstroOptions['onError']>().toEqualTypeOf<string | undefined>()
    sygnalAstro({ onError: './src/onError.js' })
    // @ts-expect-error — a module path, not the hook itself
    sygnalAstro({ onError: () => {} })
  })
})
