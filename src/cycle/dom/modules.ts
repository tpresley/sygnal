import {Module, classModule, attributesModule, datasetModule} from './snabbdom';
import {styleModule} from './styleModule';
import {selectModule} from './selectModule';
import {controlledInputModule} from './controlledInputModule';
import {classNameModule} from './classNameModule';
import {propsModule} from './propsModule';

const modules: Array<Module> = [
  styleModule,
  classModule,
  propsModule, // Sygnal's: also clears removed and nullish props (B-015, G-109)
  classNameModule, // after propsModule (B-012)
  attributesModule,
  datasetModule,
  selectModule,
  controlledInputModule,
];

export {styleModule, classModule, propsModule, attributesModule, datasetModule, selectModule, controlledInputModule, classNameModule};

export default modules;
