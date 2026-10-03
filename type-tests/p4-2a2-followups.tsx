/**
 * PLAN-4 2-A2 type tests: the Astro integration's onError module option (D120). Compiled by
 * `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import sygnalAstro from 'sygnal/astro'
import type { SygnalAstroOptions } from 'sygnal/astro'

describe('D120: Astro onError', () => {
  it('is a module path option of the integration', () => {
    expectTypeOf<SygnalAstroOptions['onError']>().toEqualTypeOf<string | undefined>()
    sygnalAstro({ onError: './src/onError.js' })
    // @ts-expect-error — a module path, not the hook itself
    sygnalAstro({ onError: () => {} })
  })
})
