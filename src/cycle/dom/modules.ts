import {Module, classModule, propsModule, attributesModule, datasetModule} from './snabbdom';
import {styleModule} from './styleModule';
import {selectModule} from './selectModule';
import {controlledInputModule} from './controlledInputModule';
import {classNameModule} from './classNameModule';
import {removedPropsModule} from './removedPropsModule';

const modules: Array<Module> = [
  styleModule,
  classModule,
  propsModule,
  classNameModule, // after propsModule (B-012)
  removedPropsModule, // after propsModule, before attributesModule (B-015)
  attributesModule,
  datasetModule,
  selectModule,
  controlledInputModule,
];

export {styleModule, classModule, propsModule, attributesModule, datasetModule, selectModule, controlledInputModule, classNameModule, removedPropsModule};

export default modules;
