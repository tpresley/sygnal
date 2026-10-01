import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

// This example links the local package (`sygnal: file:../..`), so the dev
// server loads sygnal's dist/ files from the repo root. Allow that directory
// explicitly: in a git worktree, Vite's default allow list stops at this
// example and the island's client entry gets a 403 (G-038).
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  integrations: [sygnal()],
  vite: {
    server: {
      fs: { allow: [repoRoot] },
    },
  },
})
