/**
 * SYG105 (static): an EVENTS type that is selected but never emitted, or
 * emitted but never selected, anywhere in the scanned files. String
 * literals only; when the project also has non-literal emits (or selects),
 * the finding is downgraded to info because the dynamic one might match.
 */
import { closestName } from '../names.js'

/**
 * PLAN-7 C-2: a near-miss type on the other side ('DOC_SAVE' emitted, 'DOC_SAVED' selected)
 * as a related location; nothing when no type is close.
 */
function nearMiss(type, others, what) {
  const near = closestName(type, new Set(others.map(o => o.type)))
  const at = near && others.find(o => o.type === near && o.node && o.file)
  return at ? [{ node: at.node, file: at.file, message: `'${near}' is ${what} here` }] : undefined
}

export default {
  id: 'events-counterpart',
  codes: ['SYG105'],
  description: 'EVENTS type selected but never emitted, or emitted but never selected',
  run(project, report) {
    const { selected, emitted, dynamicSelected, dynamicEmitted } = project.events
    const emittedTypes = new Set(emitted.map(e => e.type))
    const selectedTypes = new Set(selected.map(e => e.type))
    const ownerName = (e) => e.component || project.componentAt(e.file, e.node)?.name

    for (const s of selected) {
      // G-392: a first-party component's selects (<Toaster />: TOAST, TOAST_DISMISS) needn't be emitted
      if (s.implicit || emittedTypes.has(s.type)) continue
      report({
        code: 'SYG105',
        severity: dynamicEmitted.length ? 'info' : undefined,
        component: ownerName(s),
        file: s.file,
        node: s.node,
        related: nearMiss(s.type, emitted, 'emitted'),
        message: `EVENTS.select('${s.type}') but nothing in the scanned files emits '${s.type}'` +
          (dynamicEmitted.length ? ' (a non-literal emit might)' : ''),
        fix: `emit it from a model entry with EVENTS: event('${s.type}', …), or fix the event name`,
        data: { type: s.type, direction: 'selected-not-emitted' },
      })
    }
    for (const e of emitted) {
      if (selectedTypes.has(e.type)) continue
      report({
        code: 'SYG105',
        severity: dynamicSelected.length ? 'info' : undefined,
        component: ownerName(e),
        file: e.file,
        node: e.node,
        related: nearMiss(e.type, selected, 'selected'),
        message: `EVENTS type '${e.type}' is emitted but nothing in the scanned files selects it` +
          (dynamicSelected.length ? ' (a non-literal EVENTS.select() might)' : ''),
        fix: `listen with EVENTS.select('${e.type}') in the receiving component's intent, or fix the event name`,
        data: { type: e.type, direction: 'emitted-not-selected' },
      })
    }
  },
}
