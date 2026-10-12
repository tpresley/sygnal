import {h} from './cycle/dom/snabbdom';
// the core's host for this marker, registered on import (D157): unlike Portal, Transition and
// Suspense (G-751), not on first use, because the lowercase tag works without an import (docs)
import './core/hosts/switchable';

/** `<Switchable of={{ a: A, b: B }} current={state.tab} />`: a marker vnode the core's Switchable host renders */
const Switchable = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('switchable', {props: sanitizedProps}, children);
};
(Switchable as any).componentName = 'switchable';
(Switchable as any).preventInstantiation = true;

export {Switchable};
export default Switchable;
