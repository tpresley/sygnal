import { run } from 'sygnal'
import { makeChatDriver, uiMessageStream } from 'sygnal/ai'
import App from './App.jsx'

run(App, { LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }) })
