import { run, makeFetchDriver } from 'sygnal'
import { makeChatDriver, uiMessageStream } from 'sygnal/ai'
import App from './App.jsx'

run(App, {
  HTTP: makeFetchDriver(),
  LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }),
})
