import {h} from './cycle/dom/snabbdom';
// the core's handler for this marker (D157), registered when a tag uses it (G-751: the pragma calls
// `$reg`; not on import, so a bundle that never uses the marker drops the handler)
import {enableCollection as reg} from './core/hosts/collection';

/** `<Collection of={Item} from="items" />`: a marker vnode the core's Collection host renders */
const Collection = (props: any) => {
  reg();
  const {children, ...sanitizedProps} = props;
  return h('collection', {props: sanitizedProps}, children);
};
(Collection as any).componentName = 'collection';
(Collection as any).preventInstantiation = true;
(Collection as any).$reg = reg;

export {Collection};
export default Collection;
