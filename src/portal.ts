import {h} from './cycle/dom/snabbdom';

const Portal = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('portal', {props: sanitizedProps}, children);
};
(Portal as any).label = 'portal';
(Portal as any).preventInstantiation = true;

export {Portal};
export default Portal;
