import { run } from 'sygnal'
import App from './app'

import './style.css'

const { hmr } = run(App)

if (import.meta.hot) {
  import.meta.hot.accept('./app', (mod) => {
    hmr((mod as { default?: typeof App })?.default ?? App)
  })
}
