'use strict'

import xs from './xstreamCompat.js'

export default function processDrag({ draggable, dropZone } = {}, options = {}) {
  const { effectAllowed = 'move' } = options

  const dragStart$ = draggable
    ? draggable.events('dragstart').map(e => { e.dataTransfer.effectAllowed = effectAllowed; return e })
    : xs.never()

  const dragEnd$ = draggable
    ? draggable.events('dragend').mapTo(null)
    : xs.never()

  const dragOver$ = dropZone
    ? dropZone.events('dragover').map(e => { e.preventDefault(); return null })
    : xs.never()

  const drop$ = dropZone
    ? dropZone.events('drop').map(e => { e.preventDefault(); return e })
    : xs.never()

  return { dragStart$, dragEnd$, dragOver$, drop$ }
}
