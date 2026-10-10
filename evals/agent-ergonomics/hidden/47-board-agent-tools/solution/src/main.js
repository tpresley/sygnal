import { run } from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import App from './App.jsx'

const app = run(App)
experimentalExposeWebMcp(app)
