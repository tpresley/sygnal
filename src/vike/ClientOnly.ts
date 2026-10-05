import {h} from '../cycle/dom/snabbdom';

const ClientOnly = (props: any) => {
  const {children, ...sanitizedProps} = props;
  return h('clientonly', {props: sanitizedProps}, children);
};
(ClientOnly as any).componentName = 'clientonly';
(ClientOnly as any).preventInstantiation = true;

export {ClientOnly};
