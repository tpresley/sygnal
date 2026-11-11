import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'
import { fakeApi } from './api.js'
import './styles.css'

// no server in this example: run()'s argument is where a stand-in backend goes
const { hmr, dispose } = run(App, { HTTP: makeFetchDriver({ fetch: fakeApi() }) })

if (import.meta.hot) {
  import.meta.hot.accept('./App.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
