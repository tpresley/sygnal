import { run } from 'sygnal'
import App from './App.jsx'
import './styles.css'

const { hmr, dispose } = run(App)

if (import.meta.hot) {
  import.meta.hot.accept('./App.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
