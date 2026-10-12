import { run } from 'sygnal'
import { makeChatDriver, uiMessageStream } from 'sygnal/ai'
import App from './App.jsx'

// LLM: the assistant's chat, through our server's AI SDK route (it holds the key and the model)
run(App, { LLM: makeChatDriver({ transport: uiMessageStream('/api/chat') }) })
