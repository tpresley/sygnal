import { run, makeTimerDriver } from 'sygnal'
import { makeChatDriver, chatCompletions } from 'sygnal/ai'
import App from './App.jsx'
import { OLLAMA } from './llm.js'
import './styles.css'

run(App, {
  // compose.llm()'s requests: Ollama's OpenAI-compatible endpoint, thinking off, deterministic
  LLM: makeChatDriver({
    transport: chatCompletions({ baseURL: `${OLLAMA}/v1`, body: { temperature: 0, reasoning_effort: 'none' } }),
  }),
  // the board's simulated clock
  TIMER: makeTimerDriver(),
})
