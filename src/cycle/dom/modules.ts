import {Module, classModule, propsModule, attributesModule, datasetModule} from './snabbdom';
import {styleModule} from './styleModule';
import {selectModule} from './selectModule';
import {controlledInputModule} from './controlledInputModule';
import {classNameModule} from './classNameModule';

const modules: Array<Module> = [
  styleModule,
  classModule,
  propsModule,
  classNameModule, // after propsModule (B-012)
  attributesModule,
  datasetModule,
  selectModule,
  controlledInputModule,
];

export {styleModule, classModule, propsModule, attributesModule, datasetModule, selectModule, controlledInputModule, classNameModule};

export default modules;
