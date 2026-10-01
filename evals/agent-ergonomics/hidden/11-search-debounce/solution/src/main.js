import { run } from 'sygnal'
import App from './App.jsx'
import { searchDriver } from './searchDriver.js'

run(App, { SEARCH: searchDriver })
