import {run} from 'sygnal'
import App from './app.jsx'
import {createWorkerTarget} from '../src/worker-target'

const target = createWorkerTarget(self as any)
run(App as any, {DOM: target.driver} as any)
