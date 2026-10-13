import { run, makeFetchDriver, driverFromAsync } from 'sygnal'
import { makeLLM, ROUTES } from '../../shared/providers.js'
import AnyModel from './AnyModel.jsx'
import src from './AnyModel.jsx?raw'
import mainSrc from './index.js?raw'
import providersSrc from '../../shared/providers.js?raw'
import pickerSrc from '../../shared/picker.jsx?raw'

export const start = (mountPoint, uid) => run(AnyModel, {
  LLM: makeLLM(),                 // one chat driver; the routed transport picks the provider per request
  HTTP: makeFetchDriver(),        // the model list (GET /api/providers)
  CHROME: driverFromAsync(() => ROUTES.chrome.transport.status()),
}, { mountPoint, uid })

export const files = { 'AnyModel.jsx': src, 'index.js': mainSrc, 'shared/providers.js': providersSrc, 'shared/picker.jsx': pickerSrc }
