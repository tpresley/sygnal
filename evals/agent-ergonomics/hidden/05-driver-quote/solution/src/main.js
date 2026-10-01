import { run } from 'sygnal'
import App from './App.jsx'
import { quoteDriver } from './quoteDriver.js'

run(App, { QUOTE: quoteDriver })
