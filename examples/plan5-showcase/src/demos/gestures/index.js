import * as kanban from './Kanban.jsx'
import kanbanSrc from './Kanban.jsx?raw'
import * as mixer from './Mixer.jsx'
import mixerSrc from './Mixer.jsx?raw'
import nudgeSrc from './nudge.js?raw'
import * as checklist from './Checklist.jsx'
import checklistSrc from './Checklist.jsx?raw'

export const section = {
  id: 'gestures',
  title: 'Drag, undo & behaviors',
  intro: 'sortable reorders lists by pointer, touch and keyboard with screen-reader announcements; undo records a whole drag as one step; defineBehavior lets your own behaviors do the same (gestures, timers, host-state reducers).',
  demos: [
    {
      id: 'sortable-undo',
      title: 'sortable across two lists + undo with an array key',
      description: 'Drag a handle with the mouse, or focus it and use the keyboard (Space, arrows, Left / Right to change lists, Escape to cancel). Announcements go to a live region (the drop message is custom). undo({ key: [\'todo\', \'done\'] }) records both lists together, one step per drag.',
      refs: 'B-1 · S-9 · D194 · D218 · D219 · D221',
      files: { 'Kanban.jsx': kanbanSrc },
      start: kanban.start,
    },
    {
      id: 'define-behavior',
      title: 'defineBehavior: persist: false, undoStep, HOST, timers',
      description: 'A custom keyboard gesture: Up / Down nudge the volume live (a HOST reducer on the host\'s state), Enter commits, Escape restores, 3 s idle commits (behavior timers). undoStep: [\'COMMIT\'] makes the whole gesture one undo step; persist: false keeps the gesture out of persist().',
      refs: 'D197 · D218',
      files: { 'Mixer.jsx': mixerSrc, 'nudge.js': nudgeSrc },
      start: mixer.start,
    },
    {
      id: 'focus-within',
      title: 'focusWithin: focus an element inside a child',
      description: 'Add item appends a Collection row and focuses its input from the parent\'s model: focusWithin(selector) searches under the sender\'s root, children included, after the patch that renders the row.',
      refs: 'D194',
      files: { 'Checklist.jsx': checklistSrc },
      start: checklist.start,
    },
  ],
}
