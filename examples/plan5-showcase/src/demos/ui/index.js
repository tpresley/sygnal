import * as profile from './Profile.jsx'
import profileSrc from './Profile.jsx?raw'
import * as account from './Account.jsx'
import accountSrc from './Account.jsx?raw'
import * as filters from './Filters.jsx'
import filtersSrc from './Filters.jsx?raw'
import * as toolbar from './Toolbar.jsx'
import toolbarSrc from './Toolbar.jsx?raw'
import * as settings from './Settings.jsx'
import settingsSrc from './Settings.jsx?raw'
import * as faq from './Faq.jsx'
import faqSrc from './Faq.jsx?raw'
import * as order from './Order.jsx'
import orderSrc from './Order.jsx?raw'
import * as notes from './Notes.jsx'
import notesSrc from './Notes.jsx?raw'
import * as picker from './Picker.jsx'
import pickerSrc from './Picker.jsx?raw'
import cssSrc from '../../shell/demos.css?raw'

const css = { 'demos.css': cssSrc }

export const section = {
  id: 'ui',
  title: 'UI parts (sygnal/ui)',
  intro: 'Headless parts on native HTML: <dialog>, the Popover API and CSS anchor positioning do the hard work, and behaviors add state, keyboard handling and ARIA attributes. You write the markup and the CSS. Menu, Select and Combobox run Zag.js machines, one subpath each.',
  demos: [
    {
      id: 'ui-dialog',
      title: 'Dialog + toasts above a modal',
      description: 'A native <dialog> opened with showModal(): focus trap, inert page, Escape and focus return come from the browser; open and returnValue live in state, Save closes it from the model with a return value. A toast sent from inside the open modal is moved into it by the Toaster, so it stays visible and clickable.',
      refs: 'U-1 · S-3 · D195 · D198',
      files: { 'Profile.jsx': profileSrc, ...css },
      start: profile.start,
    },
    {
      id: 'ui-dialog-cancelable',
      title: 'Dialog with cancelable: false',
      description: 'Escape doesn\'t close it (closedby="none" while open), but every Escape still runs confirm.CANCEL, which the host counts; the user has to choose a button. A <Toaster> region moved into the open modal (two other cards here have one) does not change that: only a popover Escape closes first (auto or hint) takes the Escape.',
      refs: 'U-1 · G-405 · G-429 · G-579',
      files: { 'Account.jsx': accountSrc },
      start: account.start,
    },
    {
      id: 'ui-popover',
      title: 'Popover',
      description: 'A popover="auto" panel opened by a popovertarget button with no code (light dismiss included). state.filters.open follows its toggle event; filters.OPEN from the intent opens it too; the Done button closes it through the behavior.',
      refs: 'U-1 · S-3 · D196 (popovertarget as an attribute)',
      files: { 'Filters.jsx': filtersSrc },
      start: filters.start,
    },
    {
      id: 'ui-tooltip',
      title: 'Tooltip',
      description: 'A manual popover placed by CSS anchor positioning, shown after showDelay on hover or focus and hidden after hideDelay. The delays are timers declared by the behavior, so they cancel when the pointer leaves early.',
      refs: 'U-1 · S-3 · D197 (behavior timers)',
      files: { 'Toolbar.jsx': toolbarSrc, ...css },
      start: toolbar.start,
    },
    {
      id: 'ui-tabs',
      title: 'Tabs',
      description: 'Your own buttons and panels. tabsAttrs() computes roles, ids from uid(), aria-selected and the roving tabindex; arrow keys, Home and End move between tabs. The model selects a tab with next(\'tabs.SELECT\').',
      refs: 'U-1 · S-4',
      files: { 'Settings.jsx': settingsSrc },
      start: settings.start,
    },
    {
      id: 'ui-accordion',
      title: 'Accordion',
      description: 'Header buttons that each show a panel; accordionAttrs() gives aria-expanded, aria-controls, ids and hidden. One panel at a time by default (multiple: true for several).',
      refs: 'U-1 · S-4',
      files: { 'Faq.jsx': faqSrc },
      start: faq.start,
    },
    {
      id: 'ui-disclosure',
      title: 'Disclosure',
      description: 'A button that shows and hides one section. The host adds its own entry for details.TOGGLE, which runs after the behavior\'s.',
      refs: 'U-1 · S-4',
      files: { 'Order.jsx': orderSrc },
      start: order.start,
    },
    {
      id: 'ui-toaster',
      title: 'Toaster',
      description: 'Render <Toaster /> once and send event(\'TOAST\', …) from any component. Auto-dismiss runs on timers and pauses on hover or focus; kinds map to role="status" / role="alert"; a toast with the id of a shown one replaces it (progress), TOAST_DISMISS removes them.',
      refs: 'T-1 · S-5 · D198',
      files: { 'Notes.jsx': notesSrc, ...css },
      start: notes.start,
    },
    {
      id: 'ui-zag-parts',
      title: 'Menu, Select and Combobox',
      description: 'WAI-ARIA menu button, select-only combobox and editable combobox from sygnal/ui/menu, /select and /combobox (one subpath each, so an app installs only the Zag machines it uses). Keyboard, typeahead and positioning come from Zag; values arrive as DOM events.',
      refs: 'U-1 · W-2 · D202 · D211',
      files: { 'Picker.jsx': pickerSrc, ...css },
      start: picker.start,
    },
  ],
}
