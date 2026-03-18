import {Module, classModule, propsModule, attributesModule, datasetModule} from './snabbdom';
import {styleModule} from './styleModule';

const modules: Array<Module> = [
  styleModule,
  classModule,
  propsModule,
  attributesModule,
  datasetModule,
];

export {styleModule, classModule, propsModule, attributesModule, datasetModule};

export default modules;
