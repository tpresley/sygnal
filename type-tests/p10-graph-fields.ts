// PLAN-10 A-1..A-6, A-8, D521, D522: the static graph's new optional fields (sygnal-check --graph,
// sygnal-check/schema/inspect.schema.json); additive at version 1 (D511)
import type { InspectGraph, InspectComponent, InspectChild, InspectChildSelect, InspectLocation, InspectActionTrigger } from 'sygnal'

const loc: InspectLocation = { line: 3, column: 5 }
const elsewhere: InspectLocation = { line: 1, column: 1, file: 'src/intent.js' }
const trigger: InspectActionTrigger = 'behavior'
const child: InspectChild = { name: 'Toaster', via: 'tag', id: null, external: 'sygnal/ui', line: 4, column: 7 }
const widget: InspectChild = { name: 'Menu', via: 'tag', id: null, external: 'sygnal/ui/menu', widget: true }
const lens: InspectChild = { name: 'Greeting', via: 'tag', id: 'src/App.jsx:20', state: 'user' }
const select: InspectChildSelect = { child: 'CartLine', id: 'src/CartLine.jsx:2', actions: ['LINE_QTY'], line: 17, column: 13 }

const shop: InspectComponent = {
  name: 'Shop', id: 'src/App.jsx:24', key: 'src/App.jsx#Shop', parentId: null, file: 'src/App.jsx', kind: 'switchable', viewOnly: true, entry: 'unknown',
  actions: [
    { name: 'GO', trigger: 'intent', sinks: ['STATE'], line: 34, column: 3, modelAt: { line: 39, column: 3 }, writes: ['page'] },
    // PLAN-10 A-7: unknown writes, and an item removal
    { name: 'SET', trigger: 'intent', sinks: ['STATE', 'EFFECT'], writes: null },
    { name: 'DROP', trigger: 'intent', sinks: ['STATE'], writes: [], removes: true },
  ],
  stateReads: ['page', 'cart'], stateReadsPartial: true,
  stateKeys: [], calculated: [], contextProvides: ['currency'], eventsEmitted: [], eventsSelected: ['NAVIGATE'],
  children: [child, widget, lens], selectors: [{ selector: '.logo', events: ['click'], matched: true, isolationHit: null, line: 13, column: 19 }],
  contextEntries: [{ name: 'currency', line: 30, column: 3 }],
  eventSites: [{ type: 'NAVIGATE', role: 'select', line: 34, column: 21 }],
  childSelects: [select],
  diagnostics: [{ code: 'SYG110', severity: 'warn', message: 'x', component: 'Shop', componentId: 'src/App.jsx:24' }],
}
const g: InspectGraph = {
  version: 1, source: 'static', components: [shop], diagnostics: [],
  events: { NAVIGATE: { emitters: ['Summary'], selectors: ['App'], emitterIds: ['a/Summary.jsx:3', 'b/Summary.jsx:3'], selectorIds: ['App.jsx:8'] } },
}
// PLAN-10 D522: the runtime fields (instance ids on children and events, entry, viewOnly, app, shown)
const lane: InspectComponent = {
  name: 'LaneComponent', id: '1', parentId: '0', kind: 'collection-item', app: 0,
  actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: null, eventsEmitted: ['DELETE_LANE'], eventsSelected: [],
  children: [{ name: 'TaskCard', via: 'collection', count: 2, ids: ['4', '5'] }], selectors: [], diagnostics: [],
}
const page: InspectComponent = { ...lane, name: 'NotFound', id: '9', kind: 'switchable', viewOnly: true, shown: false, children: [] }
const live: InspectGraph = {
  version: 1, source: 'runtime', components: [{ ...lane, id: '0', parentId: null, kind: 'root', entry: true }, lane, page], diagnostics: [],
  events: { DELETE_LANE: { emitters: ['LaneComponent'], selectors: ['RootComponent'], emitterIds: ['1', '2'], selectorIds: ['0'] } },
}
// @ts-expect-error shown is only ever false (omitted when shown)
const badShown: InspectComponent['shown'] = true
// @ts-expect-error app is an index
const badApp: InspectComponent['app'] = '0'
// @ts-expect-error entry is true or 'unknown'
const badEntry: InspectComponent['entry'] = false
// @ts-expect-error an event site is an emit or a select
const badRole: NonNullable<InspectComponent['eventSites']>[number]['role'] = 'listen'
// @ts-expect-error removes is only ever true (omitted otherwise)
const badRemoves: InspectComponent['actions'][number]['removes'] = false
// @ts-expect-error stateReads is a list or omitted, never null
const badReads: InspectComponent['stateReads'] = null
// @ts-expect-error a child select has its location
const noLine: InspectChildSelect = { child: 'X', id: null, actions: [] }

export { loc, elsewhere, trigger, g, badEntry, badRole, noLine, live, badShown, badApp, badRemoves, badReads }
