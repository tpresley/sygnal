// <Sandboxed source={code} />: a sandboxed component as a JSX tag of the host app, on defineWidget
// (PLAN-5 W-1). The host app's intent reads the guest's EVENTS as DOM events on the tag:
//
//   const Sandboxed = makeSandboxed(QJS, kernel)
//   // view:   <Sandboxed className="gen" source={compiled} input={{ items: state.items }}
//   //                    capabilities={{ fetch: { allow: ['https://api.example.com/v1/'] } }} />
//   // intent: PICKED: DOM.select('.gen').events('emit').detail().filter(e => e.type === 'PICKED').map(e => e.data),
//   //         FAILED: DOM.select('.gen').events('sandboxerror').detail()
//
// `input` goes to the guest's PROPS source (JSON only); a new `source` remounts the sandbox.
import {defineWidget} from 'sygnal'
import {createSandbox} from './sandbox.js'

export function makeSandboxed(QJS, kernel) {
  return defineWidget({
    tag: 'div',
    events: ['emit', 'sandboxerror'],
    mount(el, props, dispatch) {
      const sb = createSandbox(QJS, {
        kernel, source: props.source, container: el, props: props.input ?? null, limits: props.limits, policy: props.policy,
        capabilities: {...props.capabilities, onEmit: (ev) => dispatch('emit', ev)},
        onError: (e) => dispatch('sandboxerror', {reason: e.reason, message: e.message}),
      })
      return {sb, source: props.source, input: props.input}
    },
    update(w, props) {
      // a new source needs a new sandbox: key the tag by the source (key={hash}) so it remounts
      if (props.source !== w.source) throw new Error('Sandboxed: a new source remounts (key the tag by the source)')
      if (props.input !== w.input) { w.input = props.input; w.sb.setProps(props.input ?? null) }
    },
    unmount(w) { w.sb.dispose() },
  })
}
