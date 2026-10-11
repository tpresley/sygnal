import { run, makeFetchDriver, makeBrowserDriverWith, clipboardSource } from 'sygnal'
import { makeChatDriver, openResponses } from 'sygnal/ai'
import RootComponent from './RootComponent.jsx'
import { OLLAMA_URL } from './config.js'
import './styles.css'

run(RootComponent, {
  // chat turns stream from Ollama; each request names its model (the Setup dropdown)
  LLM: makeChatDriver({ transport: openResponses({ baseURL: `${OLLAMA_URL}/v1` }) }),
  // the installed models (a resource) and the decision model's requests (decide())
  HTTP: makeFetchDriver(),
  // Copy Markdown
  BROWSER: makeBrowserDriverWith(clipboardSource),
})
