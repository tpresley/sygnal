import { run, makeFetchDriver } from 'sygnal'
import App from '@app/src/App.jsx'

export default function mount(selector) {
  const { dispose } = run(App, { HTTP: makeFetchDriver() }, { mountPoint: selector })
  return dispose
}
