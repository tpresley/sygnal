import { run, makeFetchDriver } from 'sygnal'
import { makeChatDriver, chatCompletions } from 'sygnal/ai'
import App from './App.jsx'
import { OLLAMA } from './backends.js'
import './styles.css'

run(App, {
  // the model list, Jev's availability, and compose.decisions()' decide() requests
  HTTP: makeFetchDriver(),
  // compose.llm()'s structured-output requests: Ollama's OpenAI-compatible endpoint, thinking off
  // (reasoning_effort 'none': 5–15x faster for qwen3, no better layouts), deterministic
  LLM: makeChatDriver({
    transport: chatCompletions({ baseURL: `${OLLAMA}/v1`, body: { temperature: 0, reasoning_effort: 'none' } }),
  }),
})
