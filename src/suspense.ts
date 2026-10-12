import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker (D157), registered when a tag uses it (G-751: the pragma calls
// `$reg`; not on import, so a bundle that never uses the marker drops the handler)
import {enableSuspense as reg} from './core/markers/suspense';

const Suspense = (props: any) => {
  reg();
  const {children, ...sanitizedProps} = props;
  return h('suspense', {props: sanitizedProps}, children);
};
(Suspense as any).componentName = 'suspense';
(Suspense as any).preventInstantiation = true;
(Suspense as any).$reg = reg;

export {Suspense};
export default Suspense;
