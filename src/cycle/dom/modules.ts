import {Module, classModule, attributesModule, datasetModule} from './snabbdom';
import {styleModule} from './styleModule';
import {selectModule} from './selectModule';
import {controlledInputModule} from './controlledInputModule';
import {classNameModule} from './classNameModule';
import {propsModule} from './propsModule';
import {isField} from './controlledInputModule';
import {sameData} from './utils';

const list: Array<Module> = [
  styleModule,
  classModule,
  propsModule, // Sygnal's: also clears removed and nullish props (B-015, G-109)
  classNameModule, // after propsModule (B-012)
  attributesModule,
  datasetModule,
  selectModule,
  controlledInputModule,
];
// P46-P: one update hook for these modules, in their order. A vnode whose data is the same as
// last time (each bucket shallow-equal) needs none of them, unless it is a form field (the
// controlled-input and select modules re-sync it every patch)
const ups = list.map(m => m.update!);
const modules: Array<Module> = list.map(({update, ...m}) => m as Module).concat({
  update(o: any, v: any) {
    if (!isField(v) && sameData(o.data, v.data)) return;
    for (let i = 0; i < ups.length; i++) ups[i](o, v);
  },
} as Module);

export {styleModule, classModule, propsModule, attributesModule, datasetModule, selectModule, controlledInputModule, classNameModule};

export default modules;
