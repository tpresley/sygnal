'use strict'

import xs from './xstreamCompat.js'

/**
 * Creates a Cycle.js driver that handles HTML5 drag-and-drop via document-level
 * native event listeners, bypassing Cycle.js component isolation entirely.
 *
 * @param {Object} config
 * @param {string} [config.draggable] - CSS selector for draggable elements (single-type shorthand)
 * @param {string} [config.dropZone]  - CSS selector for drop zones (single-type shorthand)
 * @param {Array}  [config.draggables] - [{selector, type}] for multi-type drag
 * @param {Array}  [config.dropZones]  - [{selector, type}] for multi-type drop
 *
 * @example
 * // Single type:
 * run(Root, { DND: makeDragDriver({ draggable: '.card', dropZone: '.column' }) })
 *
 * // Multi-type:
 * run(Root, { DND: makeDragDriver({
 *   draggables: [{ selector: '.card', type: 'card' }, { selector: '.list', type: 'list' }],
 *   dropZones:  [{ selector: '.column', type: 'col' }],
 * })})
 *
 * // Source events (single-type):
 * DND.select('dragstart') // → Stream<{ element, dataset }>
 * DND.select('dragend')   // → Stream<null>
 * DND.select('drop')      // → Stream<{ dropZone, insertBefore }>
 *
 * // Source events (multi-type, using type/event notation):
 * DND.select('card/dragstart')
 * DND.select('col/drop')
 */
export function makeDragDriver({ draggable, dropZone, draggables, dropZones } = {}) {
  const draggableList = draggables ?? (draggable ? [{ selector: draggable, type: null }] : [])
  const dropZoneList  = dropZones  ?? (dropZone  ? [{ selector: dropZone,  type: null }] : [])

  const draggableSelectors = draggableList.map(d => d.selector).filter(Boolean).join(', ')
  const dropZoneSelectors  = dropZoneList.map(d => d.selector).filter(Boolean).join(', ')

  return function dragDriver(/* sink$ — reserved for future dynamic config */) {
    const bus = new EventTarget()
    const domListeners = []

    const emit = (type, detail) =>
      bus.dispatchEvent(new CustomEvent(type, { detail }))

    const on = (eventType, fn) => {
      document.addEventListener(eventType, fn)
      domListeners.push([eventType, fn])
    }

    if (draggableSelectors) {
      on('dragstart', e => {
        const el = e.target.closest(draggableSelectors)
        if (!el) return
        const entry = draggableList.find(d => el.matches(d.selector))
        e.dataTransfer.effectAllowed = 'move'
        const name = entry?.type ? `${entry.type}/dragstart` : 'dragstart'
        emit(name, { element: el, dataset: { ...el.dataset } })
      })

      on('dragend', () => {
        emit('dragend', null)
      })
    }

    if (dropZoneSelectors) {
      on('dragover', e => {
        if (e.target.closest(dropZoneSelectors)) e.preventDefault()
      })

      on('drop', e => {
        const zone = e.target.closest(dropZoneSelectors)
        if (!zone) return
        e.preventDefault()
        const zoneEntry = dropZoneList.find(d => zone.matches(d.selector))
        const insertBefore = draggableSelectors
          ? (e.target.closest(draggableSelectors) ?? null)
          : null
        const name = zoneEntry?.type ? `${zoneEntry.type}/drop` : 'drop'
        emit(name, { dropZone: zone, insertBefore })
      })
    }

    return {
      select(eventType) {
        let handler
        return xs.create({
          start(listener) {
            handler = ({ detail }) => listener.next(detail)
            bus.addEventListener(eventType, handler)
          },
          stop() {
            if (handler) bus.removeEventListener(eventType, handler)
          },
        })
      },

      /** Release document-level listeners. Call when the app is disposed. */
      dispose() {
        domListeners.forEach(([type, fn]) => document.removeEventListener(type, fn))
      },
    }
  }
}
