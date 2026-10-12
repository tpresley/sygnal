// Ollama serves the decision models (/v1/systemone) and the list of installed models (/api/tags).
// Another host: VITE_OLLAMA_URL=http://host:11434 npm run dev
export const OLLAMA_URL = (import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
export const DECIDE_URL = `${OLLAMA_URL}/v1/systemone`
