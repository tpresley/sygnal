import * as hydrate from './Hydrate.jsx'
import hydrateSrc from './Hydrate.jsx?raw'
import * as glossary from './Glossary.jsx'
import glossarySrc from './Glossary.jsx?raw'
import * as patchError from './PatchError.jsx'
import patchErrorSrc from './PatchError.jsx?raw'
import patchCssSrc from './patch-error.css?raw'
import * as scoreboard from './Scoreboard.jsx'
import scoreboardSrc from './Scoreboard.jsx?raw'
import * as shadowCard from './ShadowCard.jsx'
import shadowCardSrc from './ShadowCard.jsx?raw'
import * as pin from './Pin.jsx'
import pinSrc from './Pin.jsx?raw'
import * as tasks from './Tasks.jsx'
import tasksSrc from './Tasks.jsx?raw'
import * as quotes from './Quotes.jsx'
import quotesSrc from './Quotes.jsx?raw'
import serverSrc from '../../shared/fakeServer.js?raw'
import cartTestSrc from './CartContextTest.jsx?raw'

export const section = {
  id: 'core',
  title: 'Rendering & core fixes',
  intro: 'What PLAN-5 changed under every app: hydration that adopts the server\'s markup, stable fragments, a visible state after a DOM patch error, text and number views, plain shadow-DOM slots, controlled fields restored on ABORT, route declarers in one flush, per-component resources, and testing a child with its ancestors\' context.',
  demos: [
    {
      id: 'hydration',
      title: 'Hydration adopts the server\'s markup',
      description: 'renderToString\'s HTML is put into the mount point first (the "server" render, done in the page here). Type a nickname and tick the box, then start the app: the first client render keeps every matching element, so the typed text, the checkbox and the focus survive.',
      refs: '3-J · 3-M · D217 · D220 (G-456)',
      files: { 'Hydrate.jsx': hydrateSrc },
      start: hydrate.start,
    },
    {
      id: 'fragments',
      title: 'Fragments: keyed fragment items',
      description: 'A Collection item that returns <>…</> (a <dt>/<dd> pair inside a <dl>). The fragment is keyed by the item, so reordering moves the pair as one (a note typed into an input moves with it), and the item\'s own intent still works.',
      refs: '3-Q · D222 (G-518, G-522)',
      files: { 'Glossary.jsx': glossarySrc },
      start: glossary.start,
    },
    {
      id: 'patch-error',
      title: 'After a DOM patch error: onError phase \'patch\' + data-sygnal-error',
      description: 'A vnode hook throws during the patch. The app\'s DOM stops updating (state and events go on), run({ onError }) gets phase \'patch\' (the banner), and the mount point is marked data-sygnal-error="patch", which a CSS rule turns into an overlay. Restart disposes it, which removes the mark.',
      refs: '3-V · 3-W · D223 · D224',
      files: { 'PatchError.jsx': patchErrorSrc, 'patch-error.css': patchCssSrc },
      start: patchError.start,
    },
    {
      id: 'text-views',
      title: 'Views that return a string or a number',
      description: 'A component view (a Collection item\'s too) may return text or a number; it renders as text on the client, as renderToString does.',
      refs: '4-J (G-567)',
      files: { 'Scoreboard.jsx': scoreboardSrc },
      start: scoreboard.start,
    },
    {
      id: 'shadow-slot',
      title: 'Plain <slot> in a sygnal/element shadow component',
      description: 'defineElement(…, { shadow: true }) publishes a Sygnal component as a custom element. Its plain <slot> elements are real shadow-DOM slots, not Sygnal\'s <Slot> marker, so the light-DOM content the host app renders is projected into them.',
      refs: '3-M (G-480) · GS-13',
      files: { 'ShadowCard.jsx': shadowCardSrc },
      start: shadowCard.start,
    },
    {
      id: 'abort-restore',
      title: 'ABORT on typing restores a controlled field',
      description: 'An input action whose reducer returns ABORT re-renders the component, so the field shows the state\'s value again: letters and a seventh digit never stay in it.',
      refs: 'D205 · D196',
      files: { 'Pin.jsx': pinSrc },
      start: pin.start,
    },
    {
      id: 'router-declarers',
      title: 'Router: nested route declarers in one flush',
      description: 'The root and a nested Editor both declare route = \'ROUTE\'. The root (the guard owner) gets each route first, the Editor right after, in the same flush, before the page is patched: one patch per navigation, and text typed right after it is kept. Links are plain <a href>, intercepted by the driver (hash mode here).',
      refs: '4-J · 4-K (G-555, G-563, G-565, G-570, G-571)',
      files: { 'Tasks.jsx': tasksSrc },
      start: tasks.start,
    },
    {
      id: 'resources-per-component',
      title: 'resources per component',
      description: 'Each Collection item declares its own resource from its state: state.quote is { status, data, error, refreshing }, a changed id refetches (latest wins), { refresh } refetches keeping the data, and removing a card aborts its request. A component reads the resources it declares itself.',
      refs: 'D74 · D238',
      files: { 'Quotes.jsx': quotesSrc, 'fakeServer.js': serverSrc },
      start: quotes.start,
    },
    {
      id: 'render-component-context',
      title: 'renderComponent(C, { context }) in a test',
      description: 'Testing a child alone with the context its ancestors would give it (a Vitest test; code only).',
      refs: 'D214',
      codeOnly: true,
      files: { 'Cart.test.jsx': cartTestSrc },
    },
  ],
}
