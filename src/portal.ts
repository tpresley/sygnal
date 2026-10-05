import {h} from './cycle/dom/snabbdom';
// PLAN-4.6 R2-R4: the next core's handler for this marker, registered on import (D157)
import './core/markers/portal';

const Portal = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('portal', {props: sanitizedProps}, children);
};
(Portal as any).label = 'portal';
(Portal as any).preventInstantiation = true;

export {Portal};
export default Portal;
