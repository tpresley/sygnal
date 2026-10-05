// 'sygnal/ui/zag' (PLAN-5 U-1, D202/D203): the UI parts built on Zag.js machines with fromZag:
// Menu, Select, Combobox (widget tags). A subpath of its own so that 'sygnal/ui' (the native
// parts) never needs Zag: this entry imports @zag-js/vanilla, menu, select and combobox
// (optional peer dependencies, ~1.45.0). Each part tree-shakes on its own (pure annotations).
// Rollup turns '../../zag' into the external 'sygnal/zag' and '../../index' into 'sygnal'.
export {Menu} from './ui/zag/menu'
export {Select} from './ui/zag/select'
export {Combobox} from './ui/zag/combobox'
