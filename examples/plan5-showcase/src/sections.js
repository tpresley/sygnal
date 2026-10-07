// The sections, loaded on demand: a section's demos (and their libraries) load only when it is shown.
// The nav needs titles and demo titles up front, so they are listed here too.
export const sections = [
  { id: 'integrations', title: 'Integrations', load: () => import('./demos/integrations/index.js') },
  { id: 'ui', title: 'UI parts (sygnal/ui)', load: () => import('./demos/ui/index.js') },
  { id: 'forms', title: 'Forms', load: () => import('./demos/forms/index.js') },
  { id: 'browser', title: 'Browser sources & deferred loading', load: () => import('./demos/browser/index.js') },
  { id: 'lists', title: 'Lists', load: () => import('./demos/lists/index.js') },
  { id: 'gestures', title: 'Drag, undo & behaviors', load: () => import('./demos/gestures/index.js') },
  { id: 'core', title: 'Rendering & core fixes', load: () => import('./demos/core/index.js') },
]
