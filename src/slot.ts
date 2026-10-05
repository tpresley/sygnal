import {h} from './cycle/dom/snabbdom';

const Slot = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('slot', {props: sanitizedProps}, children);
};
(Slot as any).componentName = 'slot';
(Slot as any).preventInstantiation = true;

export {Slot};
export default Slot;
