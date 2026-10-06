/**
 * PLAN-4 2-A type tests: GS-11 app-level onError, GS-9 uid. Compiled by `npm run test:types`;
 * never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { run, renderComponent, renderToString } from 'sygnal'
import type { AppErrorHook, AppErrorInfo, AppErrorPhase, RunOptions, RenderOptions, RenderToStringOptions, Component, UidFunction, ViewProps } from 'sygnal'

describe('GS-11: onError', () => {
  it('has the phase union, incl. the reserved widget phase (D105) and patch (D223)', () => {
    expectTypeOf<AppErrorPhase>().toEqualTypeOf<'view' | 'reducer' | 'effect' | 'intent' | 'context' | 'declaration' | 'driver' | 'instantiate' | 'dispose' | 'widget' | 'patch'>()
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

describe('GS-9: uid', () => {
  it('is on the view props and the reducer props', () => {
    expectTypeOf<ViewProps['uid']>().toEqualTypeOf<UidFunction>()
    expectTypeOf<ReturnType<UidFunction>>().toEqualTypeOf<string>()
    type S = { email: string }
    const Signup: Component<S, {}, any, { SET: string }> = ({ state, uid }) => (
      <p><label for={uid('email')}>Email</label><input id={uid('email')} value={state.email} /></p>
    )
    Signup.model = {
      SET: (state, email, _next, props) => {
        expectTypeOf(props.uid).toEqualTypeOf<UidFunction>()
        return { ...state, email }
      },
    }
    void Signup
  })
})
