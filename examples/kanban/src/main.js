import { run, makeDragDriver } from 'sygnal'
import RootComponent from './RootComponent.jsx'
import './styles.css'

const { hmr, dispose } = run(RootComponent, {
  DND: makeDragDriver(),
})

if (import.meta.hot) {
  import.meta.hot.accept('./RootComponent.jsx', hmr)
  import.meta.hot.dispose(dispose)
}
