import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker, registered on import (D157)
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
