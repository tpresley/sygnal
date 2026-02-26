'use strict'

import xs from './xstreamCompat.js'

/**
 * Creates a Cycle.js driver for HTML5 drag-and-drop.
 *
 * Configuration is registered at runtime via the driver sink — components emit
 * registration objects from their model (typically from BOOTSTRAP). This lets each
 * component declare its own drag role without needing app-level config.
 *
 * Sink: Stream of registration objects emitted by components
 *   { category, draggable?, dropZone?, accepts?, dragImage? }
 *   (single object or array of objects)
 *
 *   accepts:   only accept drops from this dragging category. If omitted, accepts any.
 *   dragImage: CSS selector for the element to use as the drag preview. Resolved as
 *              the nearest ancestor of the draggable element matching this selector.
 *
 * Source: DND.select(category).events(eventType)
 *   DND.select('task').events('dragstart') → Stream<{ element, dataset }>
 *   DND.select('task').events('dragend')   → Stream<null>
 *   DND.select('lane').events('drop')      → Stream<{ dropZone, insertBefore }>
 *
 * @example
 * // App setup — no configuration needed:
 * run(Root, { DND: makeDragDriver() })
 *
 * // Register all categories from one place (e.g. Root BOOTSTRAP).
 * // Wrap in { configs: [...] } because model sinks cannot return bare arrays.
 * BOOTSTRAP: { DND: () => ({ configs: [
 *   { category: 'task',      draggable: '.task-card' },
 *   { category: 'lane',      dropZone:  '.lane-drop-zone', accepts: 'task' },
 *   { category: 'lane-sort', draggable: '.lane-drag-handle',
 *                             dropZone:  '.lane-header',
 *                             accepts:   'lane-sort',
 *                             dragImage: '.lane' },
 * ]})}
 *
 * // In Root.intent — consume events anywhere in the tree:
 * DRAG_START:      DND.select('task').events('dragstart'),
 * DROP:            DND.select('lane').events('drop'),
 * DRAG_END:        DND.select('task').events('dragend'),
 * LANE_DRAG_START: DND.select('lane-sort').events('dragstart'),
 * LANE_DROP:       DND.select('lane-sort').events('drop'),
 * LANE_DRAG_END:   DND.select('lane-sort').events('dragend'),
 */
export function makeDragDriver() {
  return function dragDriver(sink$) {
    const categories = new Map()  // category → { draggable?, dropZone?, accepts?, dragImage? }
    const bus = new EventTarget()
    const domListeners = []
    let draggingCategory = null

    const register = (config) => {
      if (!config?.category) return
      const existing = categories.get(config.category) ?? {}
      categories.set(config.category, { ...existing, ...config })
    }

    // Accumulate registrations emitted by components via the sink
    sink$.subscribe({
      next(incoming) {
        // Accept: single object, array of objects, or { configs: [...] } wrapper
        const items = incoming?.configs ?? (Array.isArray(incoming) ? incoming : [incoming])
        items.forEach(register)
      },
      error() {},
      complete() {},
    })

    const emit = (name, detail) =>
      bus.dispatchEvent(new CustomEvent(name, { detail }))

    const on = (type, fn) => {
      document.addEventListener(type, fn)
      domListeners.push([type, fn])
    }

    // Document-level listeners bypass Cycle.js component isolation entirely.
    // The categories map fills in as BOOTSTRAP fires across the component tree.

    on('dragstart', e => {
      for (const [category, config] of categories) {
        if (!config.draggable) continue
        const el = e.target.closest(config.draggable)
        if (!el) continue
        draggingCategory = category
        e.dataTransfer.effectAllowed = 'move'

        if (config.dragImage) {
          const imgEl = el.closest(config.dragImage)
          if (imgEl) {
            const rect = imgEl.getBoundingClientRect()
            e.dataTransfer.setDragImage(imgEl, e.clientX - rect.left, e.clientY - rect.top)
          }
        }

        emit(`${category}:dragstart`, { element: el, dataset: { ...el.dataset } })
        return
      }
    })

    on('dragend', () => {
      if (!draggingCategory) return
      emit(`${draggingCategory}:dragend`, null)
      draggingCategory = null
    })

    on('dragover', e => {
      for (const [, config] of categories) {
        if (!config.dropZone) continue
        // Only apply accepts filtering when we know what's being dragged
        if (draggingCategory && config.accepts && config.accepts !== draggingCategory) continue
        if (e.target.closest(config.dropZone)) {
          e.preventDefault()
          return
        }
      }
    })

    on('drop', e => {
      for (const [category, config] of categories) {
        if (!config.dropZone) continue
        if (draggingCategory && config.accepts && config.accepts !== draggingCategory) continue
        const zone = e.target.closest(config.dropZone)
        if (!zone) continue
        e.preventDefault()

        // insertBefore: find the element of the same draggable type under the cursor
        let insertBefore = null
        const draggingConfig = draggingCategory ? categories.get(draggingCategory) : null
        if (draggingConfig?.draggable) {
          insertBefore = e.target.closest(draggingConfig.draggable) ?? null
        }

        emit(`${category}:drop`, { dropZone: zone, insertBefore })
        return
      }
    })

    return {
      select(category) {
        return {
          events(eventType) {
            const busEventName = `${category}:${eventType}`
            let handler
            return xs.create({
              start(listener) {
                handler = ({ detail }) => listener.next(detail)
                bus.addEventListener(busEventName, handler)
              },
              stop() {
                if (handler) bus.removeEventListener(busEventName, handler)
              },
            })
          },
        }
      },

      /** Release document-level listeners. Call when the app is disposed. */
      dispose() {
        domListeners.forEach(([type, fn]) => document.removeEventListener(type, fn))
      },
    }
  }
}
