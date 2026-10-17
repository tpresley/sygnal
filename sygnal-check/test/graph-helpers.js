// PLAN-10 (D511): the graph's fields before PLAN-10 A-1..A-8, so the older tests assert that what
// they cover is unchanged. legacy(graph) drops the view-only components and widget children, and
// the fields A-1..A-8 added (ids, key, locations, entry, childSelects, eventSites, contextEntries,
// A-7's writes / removes / stateReads / stateReadsPartial).
const LOC = ['line', 'column', 'file']
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

export function legacyComponent(c) {
  const out = omit(c, ['key', 'viewOnly', 'entry', 'contextEntries', 'eventSites', 'childSelects', 'stateReads', 'stateReadsPartial'])
  out.actions = c.actions.map(a => omit(a, [...LOC, 'modelAt', 'writes', 'removes']))
  out.selectors = c.selectors.map(s => omit(s, LOC))
  out.children = c.children.filter(x => !x.widget).map(x => omit(x, [...LOC, 'id', 'state', 'external']))
  out.diagnostics = c.diagnostics.map(d => omit(d, ['componentId']))
  if (c.controls) out.controls = c.controls.map(x => omit(x, LOC))
  if (c.commands) out.commands = c.commands.map(x => omit(x, LOC))
  if (c.timers) out.timers = c.timers.map(x => omit(x, LOC))
  if (c.agent) {
    out.agent = { ...c.agent, actions: c.agent.actions.map(x => omit(x, LOC)) }
    if (c.agent.queries) out.agent.queries = c.agent.queries.map(x => omit(x, LOC))
  }
  return out
}

export function legacy(g) {
  return {
    ...g,
    components: g.components.filter(c => !c.viewOnly).map(legacyComponent),
    events: Object.fromEntries(Object.entries(g.events).map(([t, e]) => [t, omit(e, ['emitterIds', 'selectorIds'])])),
    diagnostics: g.diagnostics.map(d => omit(d, ['componentId'])),
  }
}
