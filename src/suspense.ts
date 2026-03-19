import {h} from './cycle/dom/snabbdom';

const Suspense = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('suspense', {props: sanitizedProps}, children);
};
(Suspense as any).label = 'suspense';
(Suspense as any).preventInstantiation = true;

export {Suspense};
export default Suspense;
