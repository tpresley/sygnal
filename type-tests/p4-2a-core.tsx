/**
 * PLAN-4 2-A type tests: GS-11 app-level onError, GS-9 uid. Compiled by `npm run test:types`;
 * never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { run, renderComponent, renderToString } from 'sygnal'
import type { AppErrorHook, AppErrorInfo, AppErrorPhase, RunOptions, RenderOptions, RenderToStringOptions } from 'sygnal'

describe('GS-11: onError', () => {
  it('has the phase union, incl. the reserved widget phase (D105)', () => {
    expectTypeOf<AppErrorPhase>().toEqualTypeOf<'view' | 'reducer' | 'effect' | 'driver' | 'instantiate' | 'widget'>()
    expectTypeOf<AppErrorInfo['phase']>().toEqualTypeOf<AppErrorPhase>()
    expectTypeOf<AppErrorInfo['componentName']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<AppErrorInfo['action']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<AppErrorInfo['driver']>().toEqualTypeOf<string | undefined>()
  })

  it('is an option of run(), renderComponent() and renderToString()', () => {
    const hook: AppErrorHook = (error, { componentName, action, phase }) => {
      if (phase === 'widget' || phase === 'driver') return
      console.log(error, componentName, action)
    }
    expectTypeOf<RunOptions['onError']>().toEqualTypeOf<AppErrorHook | undefined>()
    expectTypeOf<RenderOptions['onError']>().toEqualTypeOf<AppErrorHook | undefined>()
    expectTypeOf<RenderToStringOptions['onError']>().toEqualTypeOf<AppErrorHook | undefined>()
    function App() { return <div /> }
    run(App, {}, { onError: hook })
    run(App, {}, { onError: (_e, i) => { expectTypeOf(i.phase).toEqualTypeOf<AppErrorPhase>() } })
    renderComponent(App, { onError: hook })
    renderToString(App, { onError: hook })
    // @ts-expect-error not a phase
    const bad: AppErrorPhase = 'render'
    void bad
  })
})
