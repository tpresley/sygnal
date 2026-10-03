import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
export const reactAdapter = (Comp) => ({
  mount(el, props) { const root = createRoot(el); flushSync(() => root.render(createElement(Comp, props))); return { root } },
  update(inst, props) { flushSync(() => inst.root.render(createElement(Comp, props))) },
  unmount(inst) { setTimeout(() => inst.root.unmount()) },
})
