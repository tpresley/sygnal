import { run } from 'sygnal'
import App from './App.jsx'
import { chatSocketDriver } from './chatSocket.js'

run(App, { CHAT: chatSocketDriver })
