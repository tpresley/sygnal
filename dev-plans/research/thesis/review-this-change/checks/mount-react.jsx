import { createRoot } from 'react-dom/client'
import App from '@app/src/App.jsx'

export default function mount(selector) {
  const root = createRoot(document.querySelector(selector))
  root.render(<App />)
  return () => root.unmount()
}
