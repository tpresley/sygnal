import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker, registered on import (D157)
import './core/markers/transition';

const Transition = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('transition', {props: sanitizedProps}, children);
};
(Transition as any).componentName = 'transition';
(Transition as any).preventInstantiation = true;

export {Transition};
export default Transition;
