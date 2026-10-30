/*
 * <Sandboxed>: a sandboxed component as a JSX tag of the host app, on defineWidget (PLAN-5 W-1).
 * The host's intent reads the guest's accepted EVENTS as `emit` DOM events on the tag:
 *
 *   import kernel from 'sygnal/sandbox/kernel?raw'
 *   // view:   <Sandboxed className="card" kernel={kernel} source={compiled} emits={{ ANSWER: AnswerSchema }}
 *   //                    input={{ bill: state.bill }} capabilities={{ fetch: { allow: ['https://api.example.com/v1/'] } }} />
 *   // intent: ANSWER: DOM.select('.card').events('emit').detail().filter(e => e.type === 'ANSWER').map(e => e.data),
 *   //         FAILED: DOM.select('.card').events('sandboxerror').detail()
 *
 * `input` goes to the guest's PROPS (JSON); a new `source` replaces the sandbox. `sandboxed(defaults)`
 * makes a tag with props preset (`kernel`, `worker`, `limits`, …).
 */
import {defineWidget} from '../index'
import {createSandbox, type SandboxOptions, type Sandbox} from './create'

export interface SandboxedProps extends Omit<SandboxOptions, 'container' | 'props' | 'onEmit' | 'onError'> {
  /** the guest's PROPS (JSON) */
  input?: any
}

export function sandboxed(defaults: Partial<SandboxedProps> = {}): any {
  const start = (el: Element, p: SandboxedProps, dispatch: (name: string, detail: any) => void): Sandbox => createSandbox({
    ...defaults, ...p,
    capabilities: {...defaults.capabilities, ...p.capabilities},
    container: el, props: p.input ?? null,
    onEmit: (ev) => dispatch('emit', ev),
    onError: (e) => dispatch('sandboxerror', {reason: e.reason, message: e.message}),
  } as SandboxOptions)
  return defineWidget({
    tag: 'div',
    events: ['emit', 'sandboxerror'],
    mount(el: Element, props: SandboxedProps, dispatch: any) {
      return {sb: start(el, props, dispatch), source: props.source, kernel: props.kernel, input: props.input, dispatch}
    },
    update(w: any, props: SandboxedProps, el: Element) {
      if (props.source !== w.source || props.kernel !== w.kernel) {
        w.sb.dispose()
        w.sb = start(el, props, w.dispatch)
        w.source = props.source
        w.kernel = props.kernel
        w.input = props.input
      } else if (props.input !== w.input) {
        w.input = props.input
        w.sb.setProps(props.input ?? null)
      }
    },
    unmount(w: any) { w.sb.dispose() },
  } as any)
}

// pure: an app that never renders the tag drops it (and defineWidget's registration with it)
export const Sandboxed = /*#__PURE__*/ sandboxed()
