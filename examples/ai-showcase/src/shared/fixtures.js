// What GET /api/providers answers, for tests: Ollama with a chat model and a decision model,
// Kindo with Kimi K3, TypeSafe with a key.
export const PROVIDERS = {
  ollama: {
    reachable: true,
    url: 'http://localhost:11434',
    models: [
      { name: 'qwen3:8b', capabilities: ['completion', 'tools', 'thinking'] },
      { name: 'nimble:latest', capabilities: ['decision'] },
    ],
  },
  kindo: { configured: true, source: 'file', reachable: true, models: ['moonshotai/Kimi-K3', 'claude-sonnet-4-5-20250929'] },
  typesafe: { configured: true, source: 'file', models: ['jev-latest'] },
}

/** Ollama only: no Kindo or TypeSafe key */
export const OLLAMA_ONLY = {
  ...PROVIDERS,
  kindo: { configured: false, source: null, reachable: false, models: [] },
  typesafe: { configured: false, source: null, models: [] },
}
