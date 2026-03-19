import {h} from './cycle/dom/snabbdom';

const Transition = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('transition', {props: sanitizedProps}, children);
};
(Transition as any).label = 'transition';
(Transition as any).preventInstantiation = true;

export {Transition};
export default Transition;
