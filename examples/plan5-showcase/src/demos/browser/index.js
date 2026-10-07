import * as environment from './Environment.jsx'
import environmentSrc from './Environment.jsx?raw'
import * as dashboard from './Dashboard.jsx'
import dashboardSrc from './Dashboard.jsx?raw'
import gaugeSrc from './Gauge.jsx?raw'

export const section = {
  id: 'browser',
  title: 'Browser sources & deferred loading',
  intro: 'A component declares what to watch in the browser as a function of its state (media queries, visibility, network, storage keys, element size and visibility) and gets each change as its own action; clipboard and storage writes are commands with reply actions. lazy() can wait until a placeholder is visible or the browser is idle.',
  demos: [
    {
      id: 'browser-sources',
      title: 'The browser static and makeBrowserDriver()',
      description: 'Seven sources declared in one static: media (color scheme, width), visibility, online, a storage key, resize of the dashed box and intersection of a sentinel in the scroll box. Store / Remove write the key through the driver (the storage source sees it); Copy writes the clipboard and replies with COPIED.',
      refs: 'B-3 · S-8',
      files: { 'Environment.jsx': environmentSrc },
      start: environment.start,
    },
    {
      id: 'lazy-when',
      title: 'lazy(…, { when: \'visible\' | \'idle\' })',
      description: 'Two deferred components: one starts its import when the browser is idle, the other when its placeholder scrolls into view (placeholderHeight keeps the layout from jumping).',
      refs: 'B-4 · D103 · D207 · D212',
      files: { 'Dashboard.jsx': dashboardSrc, 'Gauge.jsx': gaugeSrc },
      start: dashboard.start,
    },
  ],
}
