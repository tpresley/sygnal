/**
 * SYG105 — EVENTS type emitted but never selected, or selected but never
 * emitted (info).
 *
 * Mechanism: the EVENTS driver (src/extra/eventDriver.ts) calls onBusSelect
 * for every EVENTS.select(type) and onBusEmit for every bus event.
 *   - emitted, nothing selects it: reported when the event is emitted. The bus
 *     is a broadcast, so an event nobody has subscribed to by then is dropped.
 *   - selected, never emitted: only knowable at the end of a session, so it is
 *     reported on demand by checkEventBus() (inspect / test helpers), never
 *     automatically.
 * EVENTS.select() with no type (all events) counts as selecting everything.
 */
import type {DiagnosticCheck} from '../index'
import {report, once, onReset, didYouMean} from './shared'

let selected = new Set<string>()
let emitted = new Set<string>()
let selectsAll = false

onReset(() => { selected = new Set(); emitted = new Set(); selectsAll = false })

export const eventsCheck: DiagnosticCheck = {
  id: 'events',

  onBusSelect(type) {
    if (type === undefined || type === null || type === '') { selectsAll = true; return }
    for (const t of ([] as any[]).concat(type)) if (typeof t === 'string') selected.add(t)
  },

  onBusEmit(type, emitterName) {
    if (typeof type !== 'string') return
    emitted.add(type)
    if (selectsAll || selected.has(type) || !once(`SYG105:emit:${type}`)) return
    report('SYG105', {
      component: emitterName,
      message: `EVENTS event '${type}' was emitted, but nothing selects it, so it was dropped${didYouMean(type, selected)}`,
      fix: `Subscribe with EVENTS.select('${type}') in the component that should react, or check the event name`,
      data: {type, direction: 'emitted-not-selected', emitter: emitterName},
    })
  },
}

export interface EventBusSummary {
  selected: string[]
  emitted: string[]
  selectedNeverEmitted: string[]
  emittedNeverSelected: string[]
}

/**
 * Report SYG105 (info) for every EVENTS type that has been selected but never
 * emitted so far, and return the bus registry. Intended for inspect tooling and
 * tests, at a point where the session is "done".
 */
export function checkEventBus(): EventBusSummary {
  const selectedNeverEmitted = [...selected].filter(t => !emitted.has(t))
  const emittedNeverSelected = selectsAll ? [] : [...emitted].filter(t => !selected.has(t))
  for (const type of selectedNeverEmitted) {
    if (!once(`SYG105:select:${type}`)) continue
    report('SYG105', {
      message: `EVENTS.select('${type}') is used, but no component has emitted '${type}'${didYouMean(type, emitted)}`,
      fix: `Emit it from a model entry, e.g. { EVENTS: event('${type}', ...) }, or check the event name`,
      data: {type, direction: 'selected-not-emitted'},
    })
  }
  return {selected: [...selected], emitted: [...emitted], selectedNeverEmitted, emittedNeverSelected}
}
