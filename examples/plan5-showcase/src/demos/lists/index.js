import * as people from './People.jsx'
import peopleSrc from './People.jsx?raw'
import * as board from './Board.jsx'
import boardSrc from './Board.jsx?raw'
import * as groceries from './Groceries.jsx'
import groceriesSrc from './Groceries.jsx?raw'
import cssSrc from '../../shell/demos.css?raw'

export const section = {
  id: 'lists',
  title: 'Lists',
  intro: 'Long lists, animated reorders and Collections that render straight into their parent element.',
  demos: [
    {
      id: 'virtual-collection',
      title: '<VirtualCollection>: 10,000 rows',
      description: 'The same of / from props as Collection, but only the rows in view (plus overscan) have component instances. Jump to any row with the scrollToIndex element command; starred rows keep their state when scrolled out; the focused row stays rendered.',
      refs: 'V-1 · S-7 · D209 (@tanstack/virtual-core)',
      files: { 'People.jsx': peopleSrc, 'demos.css': cssSrc },
      start: people.start,
    },
    {
      id: 'collection-view-transitions',
      title: 'Collection viewTransitionName: animated reorders and moves',
      description: 'Each card gets view-transition-name card-<id>. With makeViewTransitionDOMDriver() and the viewTransitions static, MOVE, SHUFFLE and REVERSE render inside a View Transition: cards slide to their new places and fly between lanes.',
      refs: 'A-1 · S-6 · D210',
      files: { 'Board.jsx': boardSrc, 'demos.css': cssSrc },
      start: board.start,
    },
    {
      id: 'collection-no-wrapper',
      title: 'Collection without a wrapper, Transition per item',
      description: 'A Collection renders its items directly into the parent (<ul><Collection/></ul> is ul > li, valid HTML), between the parent\'s own <li>s. A <Transition> around it animates each item: new ones enter, removed ones leave in place.',
      refs: 'D229 (G-554) · D230 · 4-I',
      files: { 'Groceries.jsx': groceriesSrc, 'demos.css': cssSrc },
      start: groceries.start,
    },
  ],
}
