import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker (D157), registered when a tag uses it (G-751: the pragma calls
// `$reg`; not on import, so a bundle that never uses the marker drops the handler)
import {enablePortal as reg} from './core/markers/portal';

const Portal = (props: any) => {
  reg();
  const {children, ...sanitizedProps} = props;
  return h('portal', {props: sanitizedProps}, children);
};
(Portal as any).componentName = 'portal';
(Portal as any).preventInstantiation = true;
(Portal as any).$reg = reg;

export {Portal};
export default Portal;
