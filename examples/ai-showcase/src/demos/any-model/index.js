import { run } from 'sygnal'
import AnyModel from './AnyModel.jsx'
import src from './AnyModel.jsx?raw'
import mainSrc from './index.js?raw'
import providersSrc from '../../shared/providers.js?raw'
import pickerSrc from '../../shared/picker.jsx?raw'

export const start = (mountPoint, uid) => run(AnyModel, {}, { mountPoint, uid })

export const files = { 'AnyModel.jsx': src, 'index.js': mainSrc, 'shared/providers.js': providersSrc, 'shared/picker.jsx': pickerSrc }
