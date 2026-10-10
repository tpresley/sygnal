import { run } from 'sygnal'
import App from './App.jsx'
import Badge from './Badge.jsx'

run(App)
// G-638: a second app on the page
run(Badge, {}, { mountPoint: '#badge' })
