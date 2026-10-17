// PLAN-10 P-1: the App graph frame (graph.html, built by devtools/build.mjs). The panel (same
// extension origin) calls window.sygnalGraphFrame.show(graph, meta) with each runtime inspect()
// graph: the first call mounts the graph page (sygnal-check's graphView, window.__sygnalGraphV),
// later ones replace the graph in place (selection, view and trace kept). The returned page API
// takes the panel's host (getState), action(record) flashes and state(id, value) updates.
window.sygnalGraphFrame = {
  api: null,
  show(graph, meta) {
    const V = window.__sygnalGraphV
    if (!this.api) this.api = V.mountPage(V, graph, meta || {})
    else this.api.setGraph(graph)
    return this.api
  },
}
