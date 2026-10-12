import { run, makeFetchDriver } from 'sygnal'
import { makeChatDriver, chatCompletions } from 'sygnal/ai'
import App from './App.jsx'
import { OLLAMA } from './backends.js'
import './styles.css'

run(App, {
  // the model list, Jev's availability, and compose.decisions()' decide() requests for cards
  HTTP: makeFetchDriver(),
  // the chat, and compose.llm()'s card requests: Ollama's OpenAI-compatible endpoint, thinking off
  // (reasoning_effort 'none': much faster for qwen3), deterministic. Each request names its model.
  LLM: makeChatDriver({
    transport: chatCompletions({ baseURL: `${OLLAMA}/v1`, body: { temperature: 0, reasoning_effort: 'none' } }),
  }),
})
