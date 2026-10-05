/**
 * PLAN-5 1-F (D197) type tests: defineBehavior's timers, options and key in model handlers and
 * the intent, and HOST reducers. Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { defineBehavior, ABORT } from 'sygnal'
import type { BehaviorProps, Timers } from 'sygnal'

type Options = { delay: number; from: string; button: string }

describe('D197: defineBehavior extensions', () => {
  it('timers get the slice, the options and the key', () => {
    defineBehavior({
      initialState: { pending: false },
      timers: (slice, options: Options, key) => {
        expectTypeOf(slice.pending).toEqualTypeOf<boolean>()
        expectTypeOf(options.delay).toEqualTypeOf<number>()
        expectTypeOf(key).toEqualTypeOf<string>()
        return { show: slice.pending && { after: options.delay, action: 'SHOW' } }
      },
      model: { SHOW: (s) => ({ ...s, pending: false }) },
    })
    defineBehavior({
      initialState: { pending: false },
      // @ts-expect-error a timer spec needs a number delay
      timers: () => ({ show: { after: 'soon', action: 'SHOW' } }),
    })
    expectTypeOf<Timers>().toMatchTypeOf<Record<string, unknown>>()
  })

  it('model handlers get (slice, data, next, props, options, key); the intent gets (sources, options, key)', () => {
    defineBehavior({
      initialState: { n: 0 },
      intent: ({ DOM }, options: Options, key) => {
        expectTypeOf(key).toEqualTypeOf<string>()
        return { BUMP: DOM.click(options.button) }
      },
      model: {
        BUMP: (s, _d, _next, props, options, key) => {
          expectTypeOf(props).toEqualTypeOf<BehaviorProps>()
          expectTypeOf(options.delay).toEqualTypeOf<number>()
          expectTypeOf(key).toEqualTypeOf<string>()
          return { ...s, n: s.n + 1 }
        },
        // @ts-expect-error a slice reducer returns the slice
        BAD: (s) => ({ ...s, n: 'one' }),
        SIDE: {
          EFFECT: (_s, _d, _next, props, options) => { expectTypeOf(props.signal).toEqualTypeOf<AbortSignal | undefined>(); void options.from },
          EVENTS: (s, _d, _n, _p, _o, key) => ({ type: key + '.BUMPED', data: s.n }),
        },
        // the older 1-4 argument handlers still type-check
        OLD: (s, d: number, next) => { next('BUMP'); return { ...s, n: d } },
      },
    })
  })

  it('HOST reducers get and return the host state', () => {
    defineBehavior({
      initialState: { moves: 0 },
      model: {
        UP: { HOST: (state, id: string, next, _props, options: Options, key) => {
          next('MOVED', id)
          const list = state[options.from] as Array<{ id: string }>
          if (!list.length) return ABORT
          return { ...state, [options.from]: [...list].reverse(), [key]: { moves: state[key].moves + 1 } }
        } },
        MOVED: { EVENTS: (_s, id) => ({ type: 'MOVED', data: id }) },
      },
    })
  })
})
