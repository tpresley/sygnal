import xs, {Stream} from 'xstream';

interface DOMSelector {
  events(eventType: string): Stream<any>;
}

interface ProcessDragSources {
  draggable?: DOMSelector;
  dropZone?: DOMSelector;
}

interface ProcessDragOptions {
  effectAllowed?: DataTransfer['effectAllowed'];
}

interface ProcessDragStreams {
  dragStart$: Stream<DragEvent>;
  dragEnd$: Stream<null>;
  dragOver$: Stream<null>;
  drop$: Stream<DragEvent>;
}

export default function processDrag(
  {draggable, dropZone}: ProcessDragSources = {},
  options: ProcessDragOptions = {}
): ProcessDragStreams {
  if (draggable && typeof draggable.events !== 'function') {
    throw new Error(
      'processDrag: draggable must have an .events() method (e.g. DOM.select(...))'
    );
  }
  if (dropZone && typeof dropZone.events !== 'function') {
    throw new Error(
      'processDrag: dropZone must have an .events() method (e.g. DOM.select(...))'
    );
  }
  const {effectAllowed = 'move'} = options;

  const dragStart$ = draggable
    ? draggable.events('dragstart').map((e: DragEvent) => {
        e.dataTransfer!.effectAllowed = effectAllowed;
        return e;
      })
    : xs.never();

  const dragEnd$ = draggable
    ? draggable.events('dragend').mapTo(null)
    : xs.never();

  const dragOver$ = dropZone
    ? dropZone.events('dragover').map((e: DragEvent) => {
        e.preventDefault();
        return null;
      })
    : xs.never();

  const drop$ = dropZone
    ? dropZone.events('drop').map((e: DragEvent) => {
        e.preventDefault();
        return e;
      })
    : xs.never();

  return {dragStart$, dragEnd$, dragOver$, drop$};
}
