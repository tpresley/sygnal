// Prototype of "element tokens as JSX tags". Userland, using the pragma's fragment path.
import { createElement } from 'sygnal'
export function controls(spec) {
  const out = {}
  for (const [name, tag] of Object.entries(spec)) {
    const sel = `[data-sygnal-control="${name}"]`
    const C = (props, children) => createElement(tag, { ...props, attrs: { ...(props?.attrs || {}), 'data-sygnal-control': name } }, ...(children || []))
    C.__sygnalFragment = true
    C.toString = () => sel
    C.sel = sel
    out[name] = C
  }
  return out
}
