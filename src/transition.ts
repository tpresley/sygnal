import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker (D157), registered when a tag uses it (G-751: the pragma calls
// `$reg`; not on import, so a bundle that never uses the marker drops the handler)
import {enableTransition as reg} from './core/markers/transition';

const Transition = (props: any) => {
  reg();
  const {children, ...sanitizedProps} = props;
  return h('transition', {props: sanitizedProps}, children);
};
(Transition as any).componentName = 'transition';
(Transition as any).preventInstantiation = true;
(Transition as any).$reg = reg;

export {Transition};
export default Transition;
