// 'sygnal/ui' (PLAN-5 U-1, D202): headless UI parts on native HTML, unstyled (class hooks and
// documented data attributes). Behaviors for `uses` (Dialog, Popover, Tooltip, Tabs, Accordion,
// Disclosure; the last three with attribute helpers the view spreads) and the Toaster component.
// Built with defineBehavior (D197: timers, options, key). Browser floor: current evergreen
// Chromium, Firefox and Safari (D195; Popover API, CSS anchor positioning, :modal).
//
// Separate entry: rollup turns the parts' '../index' imports into the external 'sygnal', so the
// entry adds 0 B to the core bundle and shares the app's core; each part tree-shakes on its own.
export {dialog} from './ui/dialog'
export {popover} from './ui/popover'
export {tooltip} from './ui/tooltip'
export {tabs, tabsAttrs} from './ui/tabs'
export {accordion, accordionAttrs} from './ui/accordion'
export {disclosure, disclosureAttrs} from './ui/disclosure'
export {Toaster} from './ui/toaster'
