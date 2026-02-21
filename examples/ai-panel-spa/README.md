# AI Virtual Panel (Sygnal Example)

This example SPA demonstrates a moderated AI panel workflow on Sygnal.

## What it does

- Accepts `API key`, `model`, and `topic`.
- Persists `API key` and `model` in localStorage between sessions.
- Auto-saves completed discussions to local history with AI-generated session titles.
- Includes a left-side history drawer to reopen or delete saved sessions.
- Uses a custom Sygnal `KINDO` driver to call:
  - `https://llm.kindo.ai/v1/chat/completions`
- Uses AI to design a virtual panel:
  - 1 moderator
  - 3-5 experts
- Builds a dedicated system prompt for each panel member.
- Runs a moderated discussion loop:
  - Moderator picks who speaks next
  - Selected expert responds with their own persona prompt
  - Moderator eventually ends with a final synthesis
- Includes a `Copy Markdown` transcript action (clipboard).

## Run

```bash
cd examples/ai-panel-spa
npm install
npm run dev
```

Then open the Vite URL and provide your Kindo API key, model name, and topic.
