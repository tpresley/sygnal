import { run, makeFetchDriver } from 'sygnal'
import App from './App.jsx'
import { router } from './routes.js'
import { fakeApi } from './api.js'
import './styles.css'

const { hmr, dispose } = run(App, {
  ROUTER: router.driver,
  HTTP: makeFetchDriver({ fetch: fakeApi() }),
})

if (import.meta.hot) {
  import.meta.hot.accept('./App.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
