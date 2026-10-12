import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker (D157), registered when a tag uses it (G-751: the pragma calls
// `$reg`; not on import, so a bundle that never uses the marker drops the handler)
import {enableSwitchable as reg} from './core/hosts/switchable';

/** `<Switchable of={{ a: A, b: B }} current={state.tab} />`: a marker vnode the core's Switchable host renders */
const Switchable = (props: any) => {
  reg();
  const {children, ...sanitizedProps} = props;
  return h('switchable', {props: sanitizedProps}, children);
};
(Switchable as any).componentName = 'switchable';
(Switchable as any).preventInstantiation = true;
(Switchable as any).$reg = reg;

export {Switchable};
export default Switchable;
