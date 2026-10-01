import {Module, classModule, propsModule, attributesModule, datasetModule} from './snabbdom';
import {styleModule} from './styleModule';
import {selectModule} from './selectModule';
import {controlledInputModule} from './controlledInputModule';

const modules: Array<Module> = [
  styleModule,
  classModule,
  propsModule,
  attributesModule,
  datasetModule,
  selectModule,
  controlledInputModule,
];

export {styleModule, classModule, propsModule, attributesModule, datasetModule, selectModule, controlledInputModule};

export default modules;
