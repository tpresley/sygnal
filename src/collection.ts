import {h} from './cycle/dom/snabbdom';
// the core's host for this marker, registered on import (D157): unlike Portal, Transition and
// Suspense (G-751), not on first use, because the lowercase tag works without an import (docs)
import './core/hosts/collection';

/** `<Collection of={Item} from="items" />`: a marker vnode the core's Collection host renders */
const Collection = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('collection', {props: sanitizedProps}, children);
};
(Collection as any).componentName = 'collection';
(Collection as any).preventInstantiation = true;

export {Collection};
export default Collection;
