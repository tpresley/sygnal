# Sygnal HMR Smoke Test

Minimal Vite app for testing Sygnal HMR wiring through `enableHMR()`.

## Run

```bash
cd /Users/troy/Documents/Displera/sygnal/examples/hmr-smoke
npm install
npm run dev
```

Open the local dev URL from Vite.

## Validate HMR

1. Click **Increment** a few times.
2. Edit `src/RootComponent.jsx` (for example, change the note text) and save.
3. Verify:
   - The page does not perform a full browser reload.
   - `Count` remains unchanged after the update.
   - `App boot count` remains unchanged during updates.
