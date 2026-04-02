import {Module, classModule, propsModule, attributesModule, datasetModule} from './snabbdom';
import {styleModule} from './styleModule';
import {selectModule} from './selectModule';

const modules: Array<Module> = [
  styleModule,
  classModule,
  propsModule,
  attributesModule,
  datasetModule,
  selectModule,
];

export {styleModule, classModule, propsModule, attributesModule, datasetModule, selectModule};

export default modules;
