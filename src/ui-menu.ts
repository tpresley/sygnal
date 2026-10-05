// 'sygnal/ui/menu' (PLAN-5 U-1, D202/D203/D211): Menu, a widget tag on Zag.js's menu machine
// (fromZag). A subpath per part (D211), so an app that uses Menu installs only @zag-js/vanilla and
// @zag-js/menu (optional peer dependencies, ~1.45.0), and 'sygnal/ui' (the native parts) never
// needs Zag. Rollup turns '../../zag' into the external 'sygnal/zag' (fromZag ships once when an
// app uses several parts) and '../../index' into 'sygnal'.
export {Menu} from './ui/zag/menu'
