import {h} from './cycle/dom/snabbdom';
// PLAN-4.6 R2-R4: the next core's handler for this marker, registered on import (D157)
import './core/markers/suspense';

const Suspense = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('suspense', {props: sanitizedProps}, children);
};
(Suspense as any).label = 'suspense';
(Suspense as any).preventInstantiation = true;

export {Suspense};
export default Suspense;
