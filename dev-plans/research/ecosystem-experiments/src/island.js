// Throwaway: a generic "imperative island". mount/update/unmount any foreign widget on a host element;
// its callbacks become bubbling DOM CustomEvents on the host, which intent reads with DOM.select(...).events(name).
export function island(adapter, { props = {}, events = [], ...hostData } = {}) {
  const wire = (elm, p) => {
    const out = { ...p }
    for (const name of events) out[name] = (...args) =>
      elm.dispatchEvent(new CustomEvent(name, { detail: args.length > 1 ? args : args[0], bubbles: true }))
    return out
  }
  return {
    sel: 'div', key: hostData.key, children: undefined, text: undefined, elm: undefined,
    data: {
      ...(hostData.className ? { props: { className: hostData.className } } : {}),
      islandProps: props,
      hook: {
        insert: (v) => { v.elm.__island = adapter.mount(v.elm, wire(v.elm, props)) },
        postpatch: (old, v) => { v.elm.__island = old.elm.__island; adapter.update(v.elm.__island, wire(v.elm, props)) },
        destroy: (v) => adapter.unmount(v.elm.__island),
      },
    },
  }
}
