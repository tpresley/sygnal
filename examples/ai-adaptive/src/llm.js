// The model both labs compose with: a chat model on Ollama, through compose.llm() (one
// structured-output request, streamed as a preview). The free-text params these catalogs use
// (labels, questions, a "why" on each card) need a chat model: a decision model keeps their defaults.
//
//   VITE_OLLAMA_URL=http://host:11434 VITE_MODEL=qwen3:8b npm run dev
import { compose } from 'sygnal/ai'

export const OLLAMA = (import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
export const MODEL = import.meta.env?.VITE_MODEL || 'qwen3:8b'

export const llm = (options) => compose.llm({ model: MODEL, ...options })
