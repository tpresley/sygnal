/*
 * ui-sweep round 6: the document an element is in. The parts read it instead of the global
 * `document` / `Event`, so they run on a host tree (sygnal/host: the terminal, a Web Worker's
 * tree), in an iframe and in a shadow root.
 */
const G: any = globalThis

/** `n`'s document (a host tree's, an iframe's); `n` itself when it is one; else the global one */
export const docOf = (n: any): any => n?.ownerDocument || (n?.nodeType == 9 ? n : G.document)

/** the element with the focus where `n` is: its root's (a shadow root's), else its document's */
export const focused = (n: any): any => {
  const d = docOf(n), r = n?.getRootNode?.()
  return (r && r !== d && r.activeElement) || d?.activeElement
}

/** an event from `n`'s window (`C`: its constructor's name; a window without it: Event) */
export const evt = (n: any, type: string, init: any, C = 'Event'): any => {
  const w = docOf(n)?.defaultView || G
  return new (w[C] || w.Event)(type, init)
}

/** the elements matching `sel` in `n`'s document and in its own root (a shadow root) */
export const all = (n: any, sel: string): any[] => {
  const d = docOf(n), r = n?.getRootNode?.()
  return [...(d?.querySelectorAll(sel) || []), ...(r && r !== d && r.querySelectorAll ? r.querySelectorAll(sel) : [])]
}

/** `n`'s window's MutationObserver (none for a host tree, whose nodes a browser's can't observe) */
export const observer = (n: any): any => docOf(n)?.defaultView?.MutationObserver
