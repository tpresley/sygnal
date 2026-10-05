import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker, registered on import (D157)
import './core/markers/suspense';

const Suspense = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('suspense', {props: sanitizedProps}, children);
};
(Suspense as any).componentName = 'suspense';
(Suspense as any).preventInstantiation = true;

export {Suspense};
export default Suspense;
