// G-224: InspectComponent has the static-only `commands` and `timers` of
// sygnal-check/schema/inspect.schema.json (sygnal-check --graph output)
import type { InspectComponent, InspectCommand, InspectTimer } from 'sygnal'

declare const c: InspectComponent
const commands: InspectCommand[] | undefined = c.commands
const timers: InspectTimer[] | undefined = c.timers
const method: string | undefined = commands?.[0].method
const target: string | null | undefined = commands?.[0].target
const every: number | null | undefined = timers?.[0].every
const frame: string | null | undefined = timers?.[0].frame

const fromGraph: InspectComponent = {
  name: 'Editor', id: 'src/Editor.jsx:3', parentId: null, kind: 'root', actions: [], stateKeys: [],
  calculated: [], contextProvides: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [],
  commands: [{ action: 'EDIT', method: 'focus', target: 'Title', control: 'Title' }],
  timers: [{ name: 'tick', every: 100, after: null, frame: null, action: 'TICK' }, { name: 'anim', frame: 'FRAME', background: true }],
}
// @ts-expect-error a command names its method
const noMethod: InspectCommand = { action: 'EDIT', target: null }
// @ts-expect-error background is only ever true
const bg: InspectTimer = { name: 'tick', background: false }

export { method, target, every, frame, fromGraph, noMethod, bg }
